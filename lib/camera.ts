/**
 * Request a media stream that prefers the REAR (environment-facing) camera,
 * falling back to whatever camera the device has if no rear cam is available.
 *
 * Why a single function with a chained .catch instead of two separate calls:
 * `getUserMedia` consumes the calling tab's user-gesture context. If we await
 * the first call and then make a second one, some browsers consider the gesture
 * spent and reject. Chaining .catch keeps both attempts part of the same
 * promise pipeline, so the second call inherits the same gesture token.
 *
 * IMPORTANT: this function must be CALLED synchronously inside the click
 * handler (it returns the Promise immediately — do not `await` it before
 * passing the result to the QR scanner component).
 */
export function requestRearCamera(): Promise<MediaStream> {
  // Attempt 1: strict rear-camera request. On phones with both cams this
  // returns the back camera; on single-cam laptops it throws OverconstrainedError.
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: { exact: "environment" } },
  }).catch((err) => {
    const name = (err as DOMException)?.name ?? "";
    // Fall back to any camera ONLY for the cases that mean "no rear cam":
    //   OverconstrainedError    — device doesn't have an environment-facing cam
    //   NotFoundError           — no matching device
    //   ConstraintNotSatisfiedError — older Firefox flavour of OverconstrainedError
    if (name === "OverconstrainedError" || name === "NotFoundError" || name === "ConstraintNotSatisfiedError") {
      return navigator.mediaDevices.getUserMedia({ video: true });
    }
    // Any other error (NotAllowedError, NotReadableError, SecurityError, etc.)
    // bubbles up so the scanner UI can show the right guidance.
    throw err;
  });
}
