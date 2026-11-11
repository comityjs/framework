export type {
  FailureInjectionFixture,
  InfrastructureFailureReason,
  MultiRecordAtomicityScenario,
  RepositoryUnderTest,
  SharedPersistenceScope,
  TestFixture,
  TestFrameworkAdapter,
  VersionedRepositoryTestAdapter,
} from "./types.js";

export { ConformanceError } from "./errors.js";
export { runVersionedRepositoryTests } from "./run.js";
