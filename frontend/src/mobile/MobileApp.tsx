import "./mobile.css";

/** BL-247: the phone app root. Stage 1a-s builds the real shell on this. */
export function MobileApp() {
  return (
    <div className="m-app">
      <div className="m-app__screen">Hyperspace Vault</div>
    </div>
  );
}
