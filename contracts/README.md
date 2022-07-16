# FlashV3 Package

#### Deploy Package

Private:
npm publish --registry=https://npm.pkg.github.com

You must have authenticated against the registry for this to work

#### Use Package

This has been designed to be used for creating new Strategies but
you can use the package as you wish.

This package may be private so unless it has been deployed as a package
on the public registry, you will need to follow these instructions.

1. Create a new file named .npmrc in your project root folder (same
   directory as your package.json file).

2. Paste the following: @blockzerolabs:registry=https://npm.pkg.github.com

3. Create a new file named .yarnrc.yml in your project root folder

4. Paste the following:

```yaml
npmScopes:
  "blockzerolabs":
    npmAlwaysAuth: true
    npmRegistryServer: "https://npm.pkg.github.com"
    npmAuthToken: <your GH key here>
```
