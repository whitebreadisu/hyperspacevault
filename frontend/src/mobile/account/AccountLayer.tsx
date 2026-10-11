import { ChangePasswordModal } from "../../screens/auth/ChangePasswordModal";
import { DeleteAccountModal } from "../../screens/auth/DeleteAccountModal";

// BL-251 S5-02 / S5-03: desktop's ChangePasswordModal and DeleteAccountModal,
// unchanged, as a centred layer over the current phone screen -- the S1
// AuthLayer pattern (it shares the `.m-authlayer` wrapper, so shell.css's
// card width / 16 px inputs / 44 px controls / X top-right apply; account.css
// adds the Cancel / destructive-confirm buttons AuthModal does not have).
// Open state is the route (`#/more/password`, `#/more/delete`), so the
// browser Back button closes it.

interface Props {
  kind: "password" | "delete";
  onClose: () => void;
}

export function AccountLayer({ kind, onClose }: Props) {
  return (
    <div className="m-authlayer m-acctlayer" data-layer={kind}>
      {kind === "password" ? (
        <ChangePasswordModal onClose={onClose} />
      ) : (
        <DeleteAccountModal onClose={onClose} />
      )}
    </div>
  );
}
