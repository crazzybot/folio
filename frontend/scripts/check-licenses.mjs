// Fails when a production dependency's license isn't on the allow-list in
// licenses.mjs (permissive licenses), unless it's one of the documented
// exceptions there. Run from the package to check:
//
//   node scripts/check-licenses.mjs                (in frontend/)
//   node ../frontend/scripts/check-licenses.mjs    (in desktop/)
//
// CI runs it for both, so a dependency under a license Folio can't ship is
// caught in the pull request that adds it.

import { checkLicense, productionPackageDirs, readPackage } from "./licenses.mjs";

const packages = productionPackageDirs(process.cwd()).map(readPackage);
const refused = packages
  .map((pkg) => ({ pkg, result: checkLicense(pkg) }))
  .filter(({ result }) => !result.ok);

if (refused.length > 0) {
  console.error("Production dependencies with a license that isn't allowed:\n");
  for (const { pkg, result } of refused) {
    console.error(`  ${pkg.name}@${pkg.version}: ${result.license ?? result.note}`);
  }
  console.error(
    "\nIf the license is fine to ship, add it to ALLOWED in frontend/scripts/licenses.mjs, or add the " +
      "package to EXCEPTIONS with the reason.",
  );
  process.exit(1);
}
console.log(`Licenses OK: ${packages.length} production dependencies.`);
