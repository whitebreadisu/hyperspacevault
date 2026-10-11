/** BL-247 S1-04: the stand-in for a phone screen a later slice builds. One
 * plain sentence in the normal frame, no illustration, no X (the bar stays
 * visible, so the way back is the Vault tab). */
export function ComingSoon({ sentence }: { sentence: string }) {
  return (
    <div className="m-screen m-soon">
      <div className="m-empty">
        <p>{sentence}</p>
      </div>
    </div>
  );
}
