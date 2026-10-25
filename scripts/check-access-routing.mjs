import { checkAccessRouting } from "./lib/access-routing.mjs";
if (!process.env.BRANDSPARQ_BASE_URL) throw new Error("Set BRANDSPARQ_BASE_URL explicitly.");
const report = await checkAccessRouting({ origin: process.env.BRANDSPARQ_BASE_URL });
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
