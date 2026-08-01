import { useState } from 'react';
import { enablePushForThisDevice, disablePushForThisDevice, isIosNonStandalone } from '../pushNotifications';

export default function PushDeviceToggle({ userId }) {
  const [enabled, setEnabled] = useState(typeof Notification !== 'undefined' && Notification.permission === 'granted');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleToggle() {
    setBusy(true);
    setError('');
    try {
      if (enabled) {
        await disablePushForThisDevice(userId);
        setEnabled(false);
      } else {
        await enablePushForThisDevice(userId);
        setEnabled(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn btn-outline" onClick={handleToggle} disabled={busy}>
        {enabled ? 'Disable notifications on this device' : 'Enable notifications on this device'}
      </button>
      {isIosNonStandalone() && (
        <p className="muted" style={{ marginTop: 8 }}>
          On iPhone: add this app to your Home Screen first (Share → Add to Home Screen). Safari can't send push
          notifications from a regular browser tab.
        </p>
      )}
      {error && <p className="error-text" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
