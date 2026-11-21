// Transport `cli-text`: a CLI whose whole stdout is the report. Every line
// is shown live as progress; there are no rows and no follow-ups. Generic:
// nothing here knows any particular CLI.

import type { Invocation, LaunchSpec } from '../core/types'

export type CliText = { start(spec: LaunchSpec): Invocation }
