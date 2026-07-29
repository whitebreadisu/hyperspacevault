import { useModalDismiss } from "../../hooks/useModalDismiss";
import "./AboutModal.css";

interface Props {
  onClose: () => void;
}

/** BL-125: the About & Legal surface -- non-affiliation disclosure, the
 * BL-104 privacy note (BL-126 adds a fifth bullet for feedback storage), and
 * an attribution line, in one modal reachable from
 * both the header's "Unofficial Fan Project" brand-line microcopy
 * (anonymous + signed-in) and the UserMenu's "About & Legal" item
 * (signed-in only). App owns the open/close state, same pattern as
 * AuthModal/ChangePasswordModal (see App.tsx). Visually this follows the
 * console "steel ring" idiom the card-detail/inventory popups use
 * (CardPopup.css's .cp-shell/.cp-modal double clip-path) rather than
 * AuthModal's plain rounded card, scaled down to a compact ~520px panel --
 * the design record (issue #287) calls out "angled corners + steel ring +
 * tile" explicitly, distinct from the form-modal family. Copy is drafted
 * verbatim from the design record; Jeremy reviews it in-PR (see the PR
 * description) rather than this component gaining any copy logic of its
 * own. */
export function AboutModal({ onClose }: Props) {
  useModalDismiss(onClose);

  return (
    <div className="about-overlay modal-overlay" onClick={onClose}>
      <div
        className="about-shell"
        role="dialog"
        aria-modal="true"
        aria-label="About This Project"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="about-modal">
          <button type="button" className="about-close" onClick={onClose} aria-label="Close">
            ×
          </button>

          <h2 className="about-title">About This Project</h2>

          <div className="about-body">
            <section className="about-section">
              <h3 className="about-section__label">Disclaimer</h3>
              <p className="about-section__text">
                HyperspaceVault is an unofficial fan project. It is not affiliated with, endorsed
                by, sponsored by, or approved by Disney, Lucasfilm Ltd., Fantasy Flight Games, or
                the Asmodee Group. Star Wars: Unlimited and all associated card names, images,
                logos, and trademarks are the property of their respective owners and are used here
                for identification and informational purposes only.
              </p>
            </section>

            <section className="about-section">
              <h3 className="about-section__label">Privacy</h3>
              <ul className="about-section__list">
                <li>
                  What we store: your account email address and your card collection — nothing else.
                </li>
                <li>Where it lives: Google Cloud Platform, us-central1 (Iowa, USA).</li>
                <li>
                  Leaving: deletion is self-service — Delete Account in the account menu permanently
                  removes your account and all your data.
                </li>
                <li>Tracking: none. No analytics, no ads, no third-party trackers.</li>
                <li>
                  Feedback: if you send feedback, we store your message (and your email only if you
                  opt in to contact).
                </li>
              </ul>
            </section>

            <section className="about-section">
              <h3 className="about-section__label">Attribution</h3>
              <p className="about-section__text">
                Card catalog data and images are sourced via the community swuapi.com API from
                official Star Wars: Unlimited assets. Star Wars: Unlimited is a trading card game by
                Fantasy Flight Games.
              </p>
            </section>
          </div>

          <button type="button" className="about-submit" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
