import { truncatePubkey } from "@/lib/format";
import { CopyButton } from "./copy-button";

export function PubkeyDisplay({
  pubkey,
  long = false,
}: {
  pubkey: string;
  long?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2 align-middle">
      <code
        className="font-mono text-xs text-zinc-600 dark:text-zinc-300 break-all"
        title={pubkey}
      >
        {long ? pubkey : truncatePubkey(pubkey)}
      </code>
      <CopyButton value={pubkey} label="copy" />
    </span>
  );
}
