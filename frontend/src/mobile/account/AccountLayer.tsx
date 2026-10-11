import { ChangePasswordModal } from "../../screens/auth/ChangePasswordModal";
import { DeleteAccountModal } from "../../screens/auth/DeleteAccountModal";
import { ShareManageModal } from "../../screens/shares/ShareManageModal";

// BL-251 S5-02 / S5-03 / S5-07: desktop's ChangePasswordModal,
// DeleteAccountModal and ShareManageModal, unchanged, as a centred layer over the current phone screen -- the S1
// AuthLayer pattern (it shares the `.m-authlayer` wrapper, so shell.css's
// card width / 16 px inputs / 44 px controls / X top-right apply; account.css
// adds the Cancel / destructive-confirm buttons AuthModal does not have).
// Open state is the route (`#/more/password`, `#/more/delete`, `#/more/sharing`), so the
// browser Back button closes it.

interface Props {
  kind: "password" | "delete" | "sharing";
  onClose: () => void;
}

export function AccountLayer({ kind, onClose }: Props) {
  return (
    <div className="m-authlayer m-acctlayer" data-layer={kind}>
      {kind === "password" ? (
        <ChangePasswordModal onClose={onClose} />
      ) : kind === "sharing" ? (
        <ShareManageModal onClose={onClose} />
      ) : (
        <DeleteAccountModal onClose={onClose} />
      )}
    </div>
  );
}
