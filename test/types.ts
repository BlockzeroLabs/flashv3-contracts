import { Fixture } from "ethereum-waffle";

declare module "mocha" {
  export interface Context {
    loadFixture: <T>(fixture: Fixture<T>) => Promise<T>;
  }
}
