// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Noncustodial, invoice-bound settlement. Screening is a time-bounded
/// operator policy; this router cannot prevent unsolicited wallet transfers.
contract SettleKitRouter is Ownable2Step, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PAYMENT_TYPEHASH = keccak256("Payment(bytes32 invoiceId,address payer,address merchant,address token,uint256 amount,bytes32 evidence,uint256 epoch,uint256 deadline)");
    bytes32 public constant REFUND_TYPEHASH = keccak256("Refund(bytes32 refundId,bytes32 invoiceId,address payer,address merchant,address token,uint256 amount,bytes32 evidence,uint256 epoch,uint256 deadline)");
    uint256 public constant MAX_POLICY_LIFETIME = 2 hours;
    uint256 public constant MAX_AUTHORIZATION_LIFETIME = 120 seconds;
    address public constant WHITECHAIN_USDT = 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7;

    struct Payment {
        bytes32 invoiceId;
        address payer;
        address merchant;
        address token;
        uint256 amount;
        bytes32 evidence;
        uint256 epoch;
        uint256 deadline;
    }
    struct Refund {
        bytes32 refundId;
        bytes32 invoiceId;
        address payer;
        address merchant;
        address token;
        uint256 amount;
        bytes32 evidence;
        uint256 epoch;
        uint256 deadline;
    }
    struct Settlement {
        address payer;
        address merchant;
        uint256 amount;
        uint256 refunded;
    }

    IERC20 public immutable token;
    address public authorizationSigner;
    uint256 public policyEpoch;
    uint256 public policyValidUntil;
    bytes32 public policyCommitment;
    bool public paused;
    mapping(address => bool) public denied;
    mapping(bytes32 => Settlement) public payments;
    mapping(bytes32 => bool) public usedRefunds;

    error InvalidConfiguration();
    error InvalidPolicy();
    error PolicyUnavailable();
    error AuthorizationExpired();
    error InvalidAuthorization();
    error WalletDenied();
    error WrongCaller();
    error InvoiceAlreadyPaid();
    error UnknownPayment();
    error RefundAlreadyUsed();
    error RefundExceedsPayment();
    error InexactTransfer();

    event PolicySynchronized(uint256 indexed epoch, uint256 validUntil, bytes32 commitment);
    event WalletDenialUpdated(address indexed wallet, bool blocked);
    event PauseChanged(bool paused, uint256 epoch);
    event SignerChanged(address indexed signer, uint256 epoch);
    event PaymentAccepted(bytes32 indexed invoiceId, address indexed payer, address indexed merchant, address token, uint256 amount, bytes32 evidence, uint256 epoch, uint256 deadline);
    event RefundExecuted(bytes32 indexed refundId, bytes32 indexed invoiceId, address payer, address merchant, address token, uint256 amount, bytes32 evidence, uint256 epoch, uint256 deadline);

    constructor(address token_, address policyAdmin_, address signer_)
        Ownable(policyAdmin_) EIP712("SettleKitRouter", "1")
    {
        if (token_.code.length == 0 || signer_ == address(0) || signer_ == policyAdmin_
            || IERC20Metadata(token_).decimals() != 6
            || (block.chainid == 1874 && token_ != WHITECHAIN_USDT)) revert InvalidConfiguration();
        token = IERC20(token_);
        authorizationSigner = signer_;
        // No execution is possible until the operator confirms current policy.
    }

    /// @dev Changes are explicit. Omitted wallets retain their prior denial.
    /// Restoring a cleared policy requires a fresh, strictly greater epoch.
    function syncPolicy(uint256 nextEpoch, uint256 validUntil, bytes32 commitment, address[] calldata wallets, bool[] calldata blocked) external onlyOwner {
        if (nextEpoch <= policyEpoch || validUntil <= block.timestamp
            || validUntil > block.timestamp + MAX_POLICY_LIFETIME
            || commitment == bytes32(0) || wallets.length != blocked.length || wallets.length > 512) revert InvalidPolicy();
        for (uint256 i; i < wallets.length; ++i) {
            if (wallets[i] == address(0)) revert InvalidPolicy();
            denied[wallets[i]] = blocked[i];
            emit WalletDenialUpdated(wallets[i], blocked[i]);
        }
        policyEpoch = nextEpoch;
        policyValidUntil = validUntil;
        policyCommitment = commitment;
        emit PolicySynchronized(nextEpoch, validUntil, commitment);
    }

    /// @notice Emergency changes invalidate every previously signed operation.
    function setPaused(bool value) external onlyOwner {
        paused = value;
        _invalidatePolicy();
        emit PauseChanged(value, policyEpoch);
    }

    function setAuthorizationSigner(address signer_) external onlyOwner {
        if (signer_ == address(0) || signer_ == owner() || signer_ == pendingOwner()) revert InvalidConfiguration();
        authorizationSigner = signer_;
        _invalidatePolicy();
        emit SignerChanged(signer_, policyEpoch);
    }

    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == authorizationSigner) revert InvalidConfiguration();
        super.transferOwnership(newOwner);
    }

    function pay(Payment calldata authorization, bytes calldata signature) external nonReentrant {
        if (msg.sender != authorization.payer) revert WrongCaller();
        _validate(authorization.payer, authorization.merchant, authorization.token, authorization.amount, authorization.evidence, authorization.epoch, authorization.deadline);
        if (authorization.invoiceId == bytes32(0)) revert InvalidAuthorization();
        if (payments[authorization.invoiceId].payer != address(0)) revert InvoiceAlreadyPaid();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(PAYMENT_TYPEHASH, authorization.invoiceId, authorization.payer, authorization.merchant, authorization.token, authorization.amount, authorization.evidence, authorization.epoch, authorization.deadline)));
        if (ECDSA.recover(digest, signature) != authorizationSigner) revert InvalidAuthorization();
        payments[authorization.invoiceId] = Settlement(authorization.payer, authorization.merchant, authorization.amount, 0);
        uint256 beforeBalance = token.balanceOf(authorization.merchant);
        token.safeTransferFrom(authorization.payer, authorization.merchant, authorization.amount);
        uint256 afterBalance = token.balanceOf(authorization.merchant);
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != authorization.amount) revert InexactTransfer();
        emit PaymentAccepted(authorization.invoiceId, authorization.payer, authorization.merchant, authorization.token, authorization.amount, authorization.evidence, authorization.epoch, authorization.deadline);
    }

    function refund(Refund calldata authorization, bytes calldata signature) external nonReentrant {
        Settlement storage original = payments[authorization.invoiceId];
        if (original.payer == address(0)) revert UnknownPayment();
        if (msg.sender != original.merchant) revert WrongCaller();
        _validate(authorization.payer, authorization.merchant, authorization.token, authorization.amount, authorization.evidence, authorization.epoch, authorization.deadline);
        if (authorization.refundId == bytes32(0) || authorization.payer != original.payer || authorization.merchant != original.merchant) revert InvalidAuthorization();
        if (usedRefunds[authorization.refundId]) revert RefundAlreadyUsed();
        if (authorization.amount > original.amount - original.refunded) revert RefundExceedsPayment();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(REFUND_TYPEHASH, authorization.refundId, authorization.invoiceId, authorization.payer, authorization.merchant, authorization.token, authorization.amount, authorization.evidence, authorization.epoch, authorization.deadline)));
        if (ECDSA.recover(digest, signature) != authorizationSigner) revert InvalidAuthorization();
        usedRefunds[authorization.refundId] = true;
        original.refunded += authorization.amount;
        uint256 beforeBalance = token.balanceOf(original.payer);
        token.safeTransferFrom(original.merchant, original.payer, authorization.amount);
        uint256 afterBalance = token.balanceOf(original.payer);
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != authorization.amount) revert InexactTransfer();
        emit RefundExecuted(authorization.refundId, authorization.invoiceId, original.payer, original.merchant, authorization.token, authorization.amount, authorization.evidence, authorization.epoch, authorization.deadline);
    }

    function _validate(address payer, address merchant, address token_, uint256 amount, bytes32 evidence, uint256 epoch, uint256 deadline) private view {
        if (paused || policyValidUntil < block.timestamp || policyValidUntil == 0 || epoch != policyEpoch) revert PolicyUnavailable();
        if (deadline < block.timestamp || deadline > policyValidUntil || deadline > block.timestamp + MAX_AUTHORIZATION_LIFETIME) revert AuthorizationExpired();
        if (payer == address(0) || merchant == address(0) || token_ != address(token) || amount == 0 || evidence == bytes32(0)) revert InvalidAuthorization();
        if (denied[payer] || denied[merchant]) revert WalletDenied();
    }

    function _invalidatePolicy() private {
        ++policyEpoch;
        policyValidUntil = 0;
        policyCommitment = bytes32(0);
    }
}
