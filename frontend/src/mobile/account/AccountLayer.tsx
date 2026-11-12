import { ChangePasswordModal } from "../../screens/auth/ChangePasswordModal";
import { DeleteAccountModal } from "../../screens/auth/DeleteAccountModal";
import { ShareManageModal } from "../../screens/shares/ShareManageModal";

// Desktop's ChangePasswordModal, DeleteAccountModal and ShareManageModal,
// unchanged, as a centred layer over the current phone screen -- the
// AuthLayer pattern (it shares the `.m-authlayer` wrapper, so shell.css's
// card width / 16 px inputs / 44 px controls / X top-right apply; account.css
// adds the Cancel / destructive-confirm buttons AuthModal does not have).
// Open state is the route (`#/more/password`, `#/more/delete`, `#/more/sharing`), so the
// browser Back button closes it. `#/more/sharing?stash=<id>` (a stash's Share,
// over that stash) opens the share window on that stash's link.

interface Props {
  kind: "password" | "delete" | "sharing";
  onClose: () => void;
  /** Sharing: open on this stash's link (absent = the vault link). */
  stashId?: number;
}

export function AccountLayer({ kind, onClose, stashId }: Props) {
  return (
    <div className="m-authlayer m-acctlayer" data-layer={kind}>
      {kind === "password" ? (
        <ChangePasswordModal onClose={onClose} />
      ) : kind === "sharing" ? (
        <ShareManageModal onClose={onClose} stashId={stashId} />
      ) : (
        <DeleteAccountModal onClose={onClose} />
      )}
    </div>
  );
}
