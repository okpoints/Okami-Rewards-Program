import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

const requestRedemption = httpsCallable(functions, 'requestRedemption');

function StatusBadge({ status }) {
  const className = status === 'approved' ? 'badge-approved' : status === 'rejected' ? 'badge-denied' : 'badge-pending';
  return <span className={`badge ${className}`}>{status}</span>;
}

export default function AssociateDashboard({ user }) {
  const [profile, setProfile] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [myRequests, setMyRequests] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const unsubProfile = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      setProfile(snap.data());
    });

    const rewardsQuery = query(collection(db, 'rewards'), where('active', '==', true));
    const unsubRewards = onSnapshot(rewardsQuery, (snap) => {
      setRewards(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const requestsQuery = query(
      collection(db, 'redemptionRequests'),
      where('userId', '==', user.uid),
      orderBy('requestedAt', 'desc')
    );
    const unsubRequests = onSnapshot(requestsQuery, (snap) => {
      setMyRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubProfile();
      unsubRewards();
      unsubRequests();
    };
  }, [user.uid]);

  async function handleRedeem(rewardId) {
    setMessage('');
    try {
      await requestRedemption({ rewardId });
      setMessage('Request submitted - waiting on a manager to approve it.');
    } catch (err) {
      setMessage(err.message);
    }
  }

  const totalPoints = profile?.totalPoints ?? 0;

  return (
    <div>
      <div className="card">
        <h2>Your points</h2>
        <p style={{ fontSize: 28, margin: '4px 0' }}>
          <span className="points-highlight">{totalPoints} pts</span>
        </p>
        {profile?.rosterId ? (
          <p className="muted">Linked to your Cortex history.</p>
        ) : (
          <p className="muted">Not yet linked to Cortex history - a manager needs to confirm your identity.</p>
        )}
      </div>

      {message && <div className="card"><p>{message}</p></div>}

      <div className="card">
        <h2>Rewards marketplace</h2>
        <div className="grid">
          {rewards.map((reward) => (
            <div className="reward-card" key={reward.id}>
              <div className="reward-image">
                {reward.imageUrl ? <img src={reward.imageUrl} alt={reward.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 10 }} /> : 'No image yet'}
              </div>
              <div className="reward-name">{reward.name}</div>
              <div className="reward-cost">{reward.pointCost} pts</div>
              <button
                className="btn btn-primary"
                disabled={totalPoints < reward.pointCost}
                onClick={() => handleRedeem(reward.id)}
              >
                Redeem
              </button>
            </div>
          ))}
          {rewards.length === 0 && <p className="muted">No rewards available yet.</p>}
        </div>
      </div>

      <div className="card">
        <h2>Your redemption requests</h2>
        {myRequests.length === 0 && <p className="muted">No requests yet.</p>}
        {myRequests.map((req) => (
          <div className="list-row" key={req.id}>
            <span>{req.rewardName} - {req.pointCost} pts</span>
            <StatusBadge status={req.status} />
          </div>
        ))}
      </div>
    </div>
  );
}
