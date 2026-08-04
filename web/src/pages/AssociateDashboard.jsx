import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { IdentityCheckStep } from './AuthPage';
import { rewardIcon } from '../rewardIcon';
import { formatPoints } from '../formatPoints';

const requestRedemption = httpsCallable(functions, 'requestRedemption');
const enrollInBonusTask = httpsCallable(functions, 'enrollInBonusTask');
const enrollInAnnouncement = httpsCallable(functions, 'enrollInAnnouncement');

const REDEMPTION_ELIGIBLE_STANDINGS = ['Gold', 'Platinum'];

const ENROLLMENT_STATUS_LABELS = {
  enrolled: 'Signed up - awaiting confirmation',
  confirmed: 'Confirmed - go do it!',
  completed: 'Completed - points awarded',
  denied: 'Not approved',
  not_selected: 'Not selected this time',
};

function BonusTaskEntry({ task, userId }) {
  const [enrollment, setEnrollment] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'bonusTasks', task.id, 'enrollments', userId), (snap) => {
      setEnrollment(snap.exists() ? snap.data() : null);
    });
    return unsub;
  }, [task.id, userId]);

  async function handleEnroll() {
    setBusy(true);
    setError('');
    try {
      await enrollInBonusTask({ taskId: task.id });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong>{task.title}</strong>{' '}
          <span className="muted">({task.openings} openings, {formatPoints(task.pointValue)} pts, {task.urgency})</span>
        </div>
        {enrollment ? (
          <span className="badge badge-pending">{ENROLLMENT_STATUS_LABELS[enrollment.status] || enrollment.status}</span>
        ) : (
          <button className="btn btn-primary" disabled={busy} onClick={handleEnroll}>I'll do this</button>
        )}
      </div>
      {task.description && <p className="muted">{task.description}</p>}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function AnnouncementEntry({ announcement, userId }) {
  const [enrollment, setEnrollment] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'announcements', announcement.id, 'enrollments', userId), (snap) => {
      setEnrollment(snap.exists() ? snap.data() : null);
    });
    return unsub;
  }, [announcement.id, userId]);

  async function handleEnroll() {
    setBusy(true);
    setError('');
    try {
      await enrollInAnnouncement({ announcementId: announcement.id });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong>{announcement.title}</strong>{' '}
          <span className="muted">({formatPoints(announcement.pointValue)} pts, {announcement.urgency})</span>
        </div>
        {enrollment ? (
          <span className="badge badge-pending">{ENROLLMENT_STATUS_LABELS[enrollment.status] || enrollment.status}</span>
        ) : (
          <button className="btn btn-primary" disabled={busy} onClick={handleEnroll}>Sign me up</button>
        )}
      </div>
      {announcement.description && <p className="muted">{announcement.description}</p>}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function StatusBadge({ status }) {
  const className = status === 'approved' ? 'badge-approved' : status === 'rejected' ? 'badge-denied' : 'badge-pending';
  return <span className={`badge ${className}`}>{status}</span>;
}

function toDate(value) {
  return value?.toDate ? value.toDate() : new Date(value);
}

function formatDate(value) {
  return toDate(value).toLocaleDateString();
}

export default function AssociateDashboard({ user }) {
  const [profile, setProfile] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [myRequests, setMyRequests] = useState([]);
  const [ledgerEntries, setLedgerEntries] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [bonusTasks, setBonusTasks] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [message, setMessage] = useState('');
  const [showIdentityCheck, setShowIdentityCheck] = useState(false);

  useEffect(() => {
    const unsubProfile = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      setProfile(snap.data());
    });

    const rewardsQuery = query(collection(db, 'rewards'), where('active', '==', true));
    const unsubRewards = onSnapshot(rewardsQuery, (snap) => {
      setRewards(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.pointCost - b.pointCost));
    });

    const requestsQuery = query(
      collection(db, 'redemptionRequests'),
      where('userId', '==', user.uid),
      orderBy('requestedAt', 'desc')
    );
    const unsubRequests = onSnapshot(requestsQuery, (snap) => {
      setMyRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const adjustmentsQuery = query(collection(db, 'pointAdjustments'), where('userId', '==', user.uid));
    const unsubAdjustments = onSnapshot(adjustmentsQuery, (snap) => {
      setAdjustments(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const unsubBonusTasks = onSnapshot(collection(db, 'bonusTasks'), (snap) => {
      setBonusTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((t) => t.active));
    });

    const unsubAnnouncements = onSnapshot(collection(db, 'announcements'), (snap) => {
      setAnnouncements(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => a.active));
    });

    return () => {
      unsubProfile();
      unsubRewards();
      unsubRequests();
      unsubAdjustments();
      unsubBonusTasks();
      unsubAnnouncements();
    };
  }, [user.uid]);

  // Weekly Cortex points live under the roster entry, once linked.
  useEffect(() => {
    if (!profile?.rosterId) {
      setLedgerEntries([]);
      return undefined;
    }
    const ledgerQuery = collection(db, 'roster', profile.rosterId, 'ledger');
    const unsub = onSnapshot(ledgerQuery, (snap) => {
      setLedgerEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [profile?.rosterId]);

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
  const isTierEligible = REDEMPTION_ELIGIBLE_STANDINGS.includes(profile?.currentStanding);
  const approvedRedemptions = myRequests.filter((r) => r.status === 'approved');
  const lifetimeRedeemed = approvedRedemptions.reduce((sum, r) => sum + (r.pointCost || 0), 0);
  const lifetimeEarned = totalPoints + lifetimeRedeemed;

  const nextReward = rewards
    .filter((r) => r.pointCost > totalPoints)
    .sort((a, b) => a.pointCost - b.pointCost)[0];
  const progressPct = nextReward ? Math.min(100, Math.round((totalPoints / nextReward.pointCost) * 100)) : 100;

  const transactions = [
    ...ledgerEntries.map((e) => ({
      id: `ledger-${e.id}`,
      date: e.createdAt,
      description: `Cortex week ${e.week} (${e.standing})`,
      points: e.points,
    })),
    ...adjustments.map((a) => ({
      id: `adj-${a.id}`,
      date: a.createdAt,
      description: a.reason,
      points: a.delta,
    })),
    ...approvedRedemptions.map((r) => ({
      id: `redeem-${r.id}`,
      date: r.resolvedAt || r.requestedAt,
      description: `Redeemed: ${r.rewardName}`,
      points: -r.pointCost,
    })),
  ].sort((a, b) => toDate(b.date) - toDate(a.date));

  return (
    <div>
      <div className="card">
        <h2>Your points</h2>
        <div className="points-hero">
          <div className="points-hero-stat total">
            <div className="stat-label">Total Available</div>
            <div className="stat-value">{formatPoints(totalPoints)}</div>
          </div>
          <div className="points-hero-stat">
            <div className="stat-label">Lifetime Earned</div>
            <div className="stat-value">{formatPoints(lifetimeEarned)}</div>
          </div>
          <div className="points-hero-stat">
            <div className="stat-label">Lifetime Redeemed</div>
            <div className="stat-value">{formatPoints(lifetimeRedeemed)}</div>
          </div>
        </div>

        {nextReward && (
          <div style={{ marginTop: 16 }}>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="progress-callout">
              You're only {formatPoints(nextReward.pointCost - totalPoints)} points away from redeeming {nextReward.name}!
            </p>
          </div>
        )}

        {profile?.rosterId ? (
          <p className="muted" style={{ marginTop: 12 }}>Linked to your Cortex history.</p>
        ) : showIdentityCheck ? (
          <div style={{ marginTop: 12 }}>
            <IdentityCheckStep suggestedName={profile?.fullName || ''} onDone={() => setShowIdentityCheck(false)} />
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 12 }}>
            Not yet linked to Cortex history - a manager needs to confirm your identity.{' '}
            <button className="toggle-link" onClick={() => setShowIdentityCheck(true)}>Check now</button>
          </p>
        )}
      </div>

      {message && <div className="card"><p>{message}</p></div>}

      <div className="card">
        <h2>Rewards marketplace</h2>
        {!isTierEligible && (
          <p className="progress-callout" style={{ marginBottom: 12 }}>
            🔒 Catalog locked - reach Gold standing to redeem prizes!
          </p>
        )}
        <div className="grid">
          {rewards.map((reward) => {
            const canAfford = totalPoints >= reward.pointCost;
            const locked = !isTierEligible;
            return (
              <div className={`reward-card${locked ? ' reward-card-locked' : ''}`} key={reward.id}>
                <div className="reward-image">
                  {reward.imageUrl ? (
                    <img src={reward.imageUrl} alt={reward.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 10 }} />
                  ) : (
                    <span className="reward-icon">{rewardIcon(reward.name)}</span>
                  )}
                </div>
                <div className="reward-name">{reward.name}</div>
                <div className="reward-cost">{formatPoints(reward.pointCost)} pts</div>
                {locked ? (
                  <button className="btn btn-outline" disabled>
                    🔒 Unlock at Gold Level
                  </button>
                ) : (
                  <button
                    className="btn btn-primary"
                    disabled={!canAfford}
                    onClick={() => handleRedeem(reward.id)}
                  >
                    Redeem
                  </button>
                )}
              </div>
            );
          })}
          {rewards.length === 0 && <p className="muted">No rewards available yet.</p>}
        </div>
      </div>

      <div className="card">
        <h2>Bonus tasks</h2>
        <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>
          Pick up extra shifts and tasks to earn more points - a manager approves before points are awarded.
        </p>
        {bonusTasks.length === 0 && <p className="muted">No bonus tasks available right now.</p>}
        {bonusTasks.map((task) => <BonusTaskEntry task={task} userId={user.uid} key={task.id} />)}
      </div>

      <div className="card">
        <h2>Area of highest need</h2>
        {announcements.length === 0 && <p className="muted">Nothing urgent posted right now.</p>}
        {announcements.map((a) => <AnnouncementEntry announcement={a} userId={user.uid} key={a.id} />)}
      </div>

      <div className="card">
        <h2>Your redemption requests</h2>
        {myRequests.length === 0 && <p className="muted">No requests yet.</p>}
        {myRequests.map((req) => (
          <div className="list-row" key={req.id}>
            <span>{req.rewardName} - {formatPoints(req.pointCost)} pts</span>
            <StatusBadge status={req.status} />
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Points transaction history</h2>
        {transactions.length === 0 && <p className="muted">Nothing yet.</p>}
        {transactions.map((t) => (
          <div className="transaction-row" key={t.id}>
            <span className="transaction-date">{formatDate(t.date)}</span>
            <span className="transaction-desc">{t.description}</span>
            <span className={`transaction-points ${t.points >= 0 ? 'positive' : 'negative'}`}>
              {t.points >= 0 ? '+' : ''}{formatPoints(t.points)} pts
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
