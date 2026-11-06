# Why Arkiv

SettleKit keeps private coordination in Neon PostgreSQL and publishes a separate minimal receipt projection to Arkiv. An accountant can query the public projection directly, without a merchant session, gateway API key or access to our private database. Source-chain verification lets another reader check the publisher's assertions rather than simply trusting a dashboard total.

A gateway-only PostgreSQL history endpoint would make this particular independent public query depend on the gateway's service and access policy. PostgreSQL could of course be exposed through a separate public service; our implemented distinction is the wallet-owned, queryable, expiring Arkiv projection and the SDK read path, not a claim that other databases cannot serve public data.

Private order identifiers, customer contacts, invoice contents, authentication, merchant API keys, webhook credentials and screening decisions remain off Arkiv. Their confidentiality and transactional coordination belong in private storage. Arkiv is not a replacement for monetary settlement, the authorization coordinator, or a guarantee that omitted/expired records never existed.

The visible accountant query, evidence verifier, retention labeling and source-range gap checks are the reasons to publish these records. Actual read evidence exists; signed writes remain explicitly pending test funding. See [schema and ownership](schema.md) and [how the viewer uses the data](how-you-use-arkiv.md).
