import "../../screens/about/AboutModal.css";
import { ShellHead, useShellExit } from "./ShellHead";
import "./more.css";

// BL-250 S4-02: About & Legal at #/about (title chooser, account menu, the
// Updates rail) and #/more/about (More). FORK of desktop
// screens/about/AboutModal.tsx's body (the component exports only the modal,
// so the copy is duplicated here verbatim -- BL-254 folds it back); the
// desktop .about-body / .about-section* / .about-submit rules are imported,
// not copied. Phone frame: the full-shell steel ring (18 / 17 px cuts, rev4
// m-rev4-d.css), 14 px prose (rev4: the owner reads small type as too small),
// desktop's Close button at 44 px.

export function AboutScreen({ fromMore }: { fromMore: boolean }) {
  const exit = useShellExit(fromMore);
  return (
    <div className="m-screen m-shellscreen m-about" role="dialog" aria-labelledby="m-about-title">
      <div className="m-shell">
        <div className="m-shell__panel">
          <ShellHead title="About This Project" titleId="m-about-title" fromMore={fromMore} />

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
                <li>
                  Usage analytics: to guide improvements, we collect anonymous usage data — which
                  features get used, plus session replays with everything you type masked out. It is
                  never linked to your account, and you can turn it off any time in Settings under
                  Usage Analytics. Processed by PostHog (USA). No ads, no advertising trackers, and
                  your data is never sold.
                </li>
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

          <button type="button" className="about-submit m-about__close" onClick={exit}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
