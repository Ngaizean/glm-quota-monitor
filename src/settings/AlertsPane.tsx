import { AlertsView } from "./alerts/AlertsView";
import { useAlertsController } from "./alerts/useAlertsController";

export default function AlertsPane() {
  return <AlertsView controller={useAlertsController()} />;
}
