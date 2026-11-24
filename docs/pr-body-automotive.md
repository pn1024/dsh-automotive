- [x] I added **one file** at `data/plugins/pn1024__dsh-automotive--auto-policy-plugin.yml` — that single file is the whole submission.
- [x] My repo's `package.json` declares **`dsh.bundle`** (`dsh.bundle.patch: ./cordis.patch.yml`, plus `dsh.client` for the browser half). The package lives in the `auto-policy-plugin/` subdirectory, so this entry uses the monorepo subpackage form (`url` → subdirectory, `name` → `owner/repo#subname`).
- [x] Published on npm: `dsh-plugin-automotive@1.0.0` (https://www.npmjs.com/package/dsh-plugin-automotive).
- [x] `category: tools` — the plugin registers 6 model tools (search / read / analyze / report / library stats / quotes) alongside its panel.
- [x] Description states what the plugin does, no superlatives.
- [ ] My repo is at least 1 day old — created 2026-11-24, so this is the only failing gate. Per the CI note it re-runs by itself; no resubmission needed.
- [ ] The `dsh-plugin` topic on the repo is being added.

What it does: a China automotive industry research console. 78 domestic policy documents from the State Council policy library, the Hunan provincial portal, the Hunan industry & IT department, the Hunan development & reform commission and the National Laws and Regulations Database — every entry keeping its official source link and body text, with clause-level anchors (paragraph number + quoted clause) that link back to the exact paragraph.

On top of that: national NEV penetration and brand shares from a public sales ranking, Chery's official monthly group sales / exports / NEV / sub-brand split (with a separate note that group wholesale and domestic insurance figures must not be added together), quarterly financials, earnings forecasts, analyst ratings, consensus EPS and target prices for 10 listed automakers, quarterly report PDFs from CNINFO, and a policy-to-earnings quarterly comparison.

Reports export as Markdown with a publication lint (section completeness, citation coverage, vague wording) or as a GB/T 9704 formatted Word document.

Hard rule throughout: nothing is shown, computed or written into a report without a verifiable source. Regional sales, provincial department policies and some export splits are simply absent rather than estimated.