// Contract types re-exported from Beta's published `@foundry/shared` package —
// the single source of truth shared with the generator and server.
// The rest of the app imports these via `./types` so this stays the only seam.
export type {
  BlueprintSummary,
  BlueprintManifest,
  InputSchema,
  InputField,
  SelectOption,
  GenerateRequest,
  ValidationError,
} from '@foundry/shared';
