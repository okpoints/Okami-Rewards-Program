import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

const resolveRedemption = httpsCallable(functions, 'resolveRedemption');
const seedInitialRewards = httpsCallable(functions, 'seedInitialRewards');
const seedInitialAnnouncement = httpsCallable(functions, 'seedInitialAnnouncement');
const manualCortexSync = httpsCallable(functions, 'manualCortexSync');

export default function ManagerDashboard() {
  const [pendingRequests, setPendingRequests] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const pendingQuery = query(collection(db, 'redemptionRequests'), where('status', '==', 'pending'));
    const unsubPending = onSnapshot(pendingQuery, (snap) => {
      setPendingRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const rewardsQuery = query(collection(db, 'rewards'));
    const unsubRewards = onSnapshot(rewardsQuery, (snap) => {
      setRewards(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubPending();
      unsubRewards();
    };
  }, []);

  async function handleResolve(requestId, decision) {
    setMessage('');
    try {
      await resolveRedemption({ requestId, decision });
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function handleAction(fn, successMessage) {
    setBusy(true);
    setMessage('');
    try {
      await fn();
      setMessage(successMessage);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {message && <div className="card"><p>{message}</p></div>}

      <div className="card">
        <h2>Setup</h2>
        <p className="muted">One-time actions - safe to click even if already done, they'll just tell you.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          <button className="btn btn-outline" disabled={busy} onClick={() => handleAction(() => seedInitialRewards(), 'Reward catalog seeded.')}>
            Seed initial rewards
          </button>
          <button className="btn btn-outline" disabled={busy} onClick={() => handleAction(() => seedInitialAnnouncement(), 'Announcement seeded.')}>
            Seed initial announcement
          </button>
          <button className="btn btn-outline" disabled={busy} onClick={() => handleAction(() => manualCortexSync(), 'Cortex sync complete.')}>
            Sync Now (Cortex)
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Pending redemption requests</h2>
        {pendingRequests.length === 0 && <p className="muted">Nothing pending.</p>}
        {pendingRequests.map((req) => (
          <div className="list-row" key={req.id}>
            <span>{req.rewardName} - {req.pointCost} pts</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={() => handleResolve(req.id, 'approved')}>Approve</button>
              <button className="btn btn-outline" onClick={() => handleResolve(req.id, 'rejected')}>Deny</button>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Reward catalog</h2>
        {rewards.length === 0 && <p className="muted">No rewards yet - seed the catalog above.</p>}
        {rewards.map((reward) => (
          <div className="list-row" key={reward.id}>
            <span>{reward.name}</span>
            <span>{reward.pointCost} pts {!reward.active && '(inactive)'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
