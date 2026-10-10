# Rename: NEO Canon

The fork is now **NEO Canon**. The original NEO is by Hugh Howey; this is built on it.

## Changed

- `package.json` and `package-lock.json`: `name` is `neo-canon`, `productName` is `NEO Canon`, new description, `homepage` is https://github.com/bfdcampos/neo-canon, `build.appId` is `com.bfdcampos.neocanon`, `build.publish` points at `bfdcampos/neo-canon`.
- `index.html`: the window `<title>` is `NEO Canon`.
- `main.js`: the About panel's `applicationName` is `NEO Canon`.
- `README.md` and `AGENTS.md` rewritten for NEO Canon.

## Kept on purpose

- The **NEO Library** folder (`~/Documents/NEO Library`). A writer can open the same library in NEO and NEO Canon; Canon's `canon-*` folders are ignored by NEO.
- Internal identifiers, `t()` strings and locale keys ("About NEO", "Welcome to NEO"), menu labels, code comments, the `<h1>` on the shelf, and `pocket/`. Changing a `t()` string means touching every locale file, so it waits for a real need.

## Still pointing at the original repo (left alone)

- `main.js`: the update check fetches `hughhowey/neo` releases, and an error dialog names `hughhowey/neo/issues`.
- `.github/workflows/pocket.yml` and `pocket/` docs mention `hughhowey/neo` and `com.hughhowey.neo.pocket`.
- `package.json` `build.*.maintainer` is still Hugh Howey's.

## Owner action

Rename the GitHub repository: **Settings → General → Repository name** → `neo-canon` (`bfdcampos/neo-semantics` becomes `bfdcampos/neo-canon`). GitHub redirects the old URL. Then update the local remote: `git remote set-url origin https://github.com/bfdcampos/neo-canon.git`.
