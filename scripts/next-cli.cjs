// Next.js 14.2.35 tries to fetch SWC metadata using the Next version even
// though its optional SWC dependencies are pinned to 14.2.33. Skip that
// repair attempt; npm installs the platform-specific SWC dependency itself.
process.env.NEXT_IGNORE_INCORRECT_LOCKFILE ??= "1";

require("next/dist/bin/next");
