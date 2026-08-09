import { SpinView } from "./spin/SpinView";
import { useSpinController } from "./spin/useSpinController";

export default function SpinPane() {
  return <SpinView controller={useSpinController()} />;
}
