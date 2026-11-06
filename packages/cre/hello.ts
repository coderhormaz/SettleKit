import { CronCapability, Runner, handler, type Runtime } from "@chainlink/cre-sdk";

type Config = { schedule: string };
function hello(runtime: Runtime<Config>): string {
  runtime.log("SettleKit official SDK runtime smoke.");
  return "SettleKit CRE runtime smoke";
}
export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run((config) => [handler(new CronCapability().trigger({ schedule: config.schedule }), hello)]);
}
