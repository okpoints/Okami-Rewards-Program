import { useEffect, useState } from 'react';
import {
  collection, doc, onSnapshot, query, where,
  addDoc, updateDoc, deleteDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import SearchableSelect from '../components/SearchableSelect';
import RewardImageUpload from '../components/RewardImageUpload';

const resolveRedemption = httpsCallable(functions, 'resolveRedemption');
const seedInitialRewards = httpsCallable(functions, 'seedInitialRewards');
const seedInitialAnnouncement = httpsCallable(functions, 'seedInitialAnnouncement');
const manualCortexSync = httpsCallable(functions, 'manualCortexSync');
const resolveIdentityLink = httpsCallable(functions, 'resolveIdentityLink');
const createBonusTask = httpsCallable(functions, 'createBonusTask');
const deleteBonusTask = httpsCallable(functions, 'deleteBonusTask');
const resolveBonusTask = httpsCallable(functions, 'resolveBonusTask');
const createAnnouncement = httpsCallable(functions, 'createAnnouncement');
const deleteAnnouncement = httpsCallable(functions, 'deleteAnnouncement');
const confirmAnnouncementParticipant = httpsCallable(functions, 'confirmAnnouncementParticipant');
const resolveAnnouncementCompletion = httpsCallable(functions, 'resolveAnnouncementCompletion');
const adjustPoints = httpsCallable(functions, 'adjustPoints');
const deletePointAdjustment = httpsCallable(functions, 'deletePointAdjustment');
const addRosterAlias = httpsCallable(functions, 'addRosterAlias');
const createRosterEntry = httpsCallable(functions, 'createRosterEntry');
const setRosterActive = httpsCallable(functions, 'setRosterActive');
const setManagerPermission = httpsCallable(functions, 'setManagerPermission');
const setUserRole = httpsCallable(functions, 'setUserRole');
const queryActivityLog = httpsCallable(functions, 'queryActivityLog');

const BONUS_URGENCY = ['low', 'medium', 'high', 'very_high'];
const ANNOUNCEMENT_URGENCY = ['low', 'medium', 'high', 'critical'];
const PERMISSION_LABELS = {
  viewActivityLog: 'View activity log',
  manageManagerPermissions: 'Manage other managers’ permissions',
};

function BonusTaskCard({ task, associatesById }) {
  const [enrollments, setEnrollments] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'bonusTasks', task.id, 'enrollments'), (snap) => {
      setEnrollments(snap.docs.map((d) => ({ userId: d.id, ...d.data() })));
    });
    return unsub;
  }, [task.id]);

  const pending = enrollments.filter((e) => e.status === 'enrolled');

  async function handleResolve(userId, decision) {
    setMessage('');
    try {
      await resolveBonusTask({ taskId: task.id, userId, decision });
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function handleDelete() {
    setMessage('');
    try {
      await deleteBonusTask({ taskId: task.id });
    } catch (err) {
      setMessage(err.message);
    }
  }

  return (
    <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong>{task.title}</strong>{' '}
          <span className="muted">({task.urgency}, {task.openings} openings, {task.pointValue} pts)</span>
        </div>
        <button className="btn btn-outline" onClick={handleDelete}>Delete</button>
      </div>
      {task.description && <p className="muted">{task.description}</p>}
      {pending.length === 0 && <p className="muted">No pending enrollments.</p>}
      {pending.map((e) => (
        <div className="list-row" key={e.userId}>
          <span>{associatesById[e.userId]?.fullName || e.userId}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={() => handleResolve(e.userId, 'approved')}>Approve</button>
            <button className="btn btn-outline" onClick={() => handleResolve(e.userId, 'denied')}>Deny</button>
          </div>
        </div>
      ))}
      {message && <p className="error-text">{message}</p>}
    </div>
  );
}

function AnnouncementCard({ announcement, associatesById }) {
  const [enrollments, setEnrollments] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'announcements', announcement.id, 'enrollments'), (snap) => {
      setEnrollments(snap.docs.map((d) => ({ userId: d.id, ...d.data() })));
    });
    return unsub;
  }, [announcement.id]);

  const awaitingConfirmation = enrollments.filter((e) => e.status === 'enrolled');
  const confirmed = enrollments.filter((e) => e.status === 'confirmed');

  async function handleConfirm(userId, confirmedDecision) {
    setMessage('');
    try {
      await confirmAnnouncementParticipant({ announcementId: announcement.id, userId, confirmed: confirmedDecision });
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function handleResolveCompletion(userId, decision) {
    setMessage('');
    try {
      await resolveAnnouncementCompletion({ announcementId: announcement.id, userId, decision });
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function handleDelete() {
    setMessage('');
    try {
      await deleteAnnouncement({ announcementId: announcement.id });
    } catch (err) {
      setMessage(err.message);
    }
  }

  return (
    <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong>{announcement.title}</strong>{' '}
          <span className="muted">
            ({announcement.urgency}, needs {announcement.driversNeeded}, {announcement.pointValue} pts)
          </span>
        </div>
        <button className="btn btn-outline" onClick={handleDelete}>Archive</button>
      </div>
      {announcement.description && <p className="muted">{announcement.description}</p>}

      {awaitingConfirmation.length > 0 && (
        <div>
          <p className="muted">Signed up, awaiting confirmation:</p>
          {awaitingConfirmation.map((e) => (
            <div className="list-row" key={e.userId}>
              <span>{associatesById[e.userId]?.fullName || e.userId}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={() => handleConfirm(e.userId, true)}>Confirm</button>
                <button className="btn btn-outline" onClick={() => handleConfirm(e.userId, false)}>Not selected</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmed.length > 0 && (
        <div>
          <p className="muted">Confirmed, awaiting completion:</p>
          {confirmed.map((e) => (
            <div className="list-row" key={e.userId}>
              <span>{associatesById[e.userId]?.fullName || e.userId}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={() => handleResolveCompletion(e.userId, 'approved')}>Completed</button>
                <button className="btn btn-outline" onClick={() => handleResolveCompletion(e.userId, 'denied')}>Didn't happen</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {enrollments.length === 0 && <p className="muted">No signups yet.</p>}
      {message && <p className="error-text">{message}</p>}
    </div>
  );
}

function toDate(value) {
  return value?.toDate ? value.toDate() : new Date(value);
}

function DriverPointHistory({ driver }) {
  const [ledgerEntries, setLedgerEntries] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!driver.rosterId) {
      setLedgerEntries([]);
      return undefined;
    }
    const unsub = onSnapshot(collection(db, 'roster', driver.rosterId, 'ledger'), (snap) => {
      setLedgerEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [driver.rosterId]);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'pointAdjustments'), where('userId', '==', driver.id)), (snap) => {
      setAdjustments(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [driver.id]);

  async function handleDelete(adjustmentId) {
    setMessage('');
    try {
      await deletePointAdjustment({ adjustmentId });
    } catch (err) {
      setMessage(err.message);
    }
  }

  const entries = [
    ...ledgerEntries.map((e) => ({
      id: `ledger-${e.id}`, date: e.createdAt, description: `Cortex week ${e.week} (${e.standing})`,
      points: e.points, source: 'Amazon', deletable: false,
    })),
    ...adjustments.map((a) => ({
      id: `adj-${a.id}`, date: a.createdAt, description: a.reason,
      points: a.delta, source: 'DSP', deletable: true, adjustmentId: a.id,
    })),
  ].sort((a, b) => toDate(b.date) - toDate(a.date));

  return (
    <div className="card">
      <h2>{driver.fullName || driver.email}'s point history</h2>
      <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>{driver.totalPoints ?? 0} pts total</p>
      {entries.length === 0 && <p className="muted">No point activity yet.</p>}
      {entries.map((entry) => (
        <div className="list-row" key={entry.id}>
          <span>
            <span className="badge badge-pending" style={{ marginRight: 8 }}>{entry.source}</span>
            {entry.description}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className={entry.points >= 0 ? 'accent-text-green' : 'error-text'}>
              {entry.points >= 0 ? '+' : ''}{entry.points} pts
            </span>
            {entry.deletable && (
              <button
                className="btn btn-ghost"
                title="Delete this adjustment and reverse its points"
                onClick={() => handleDelete(entry.adjustmentId)}
              >
                🗑️
              </button>
            )}
          </span>
        </div>
      ))}
      {message && <p className="error-text">{message}</p>}
    </div>
  );
}

export default function ManagerDashboard({ user, role, activeTab }) {
  const [pendingRequests, setPendingRequests] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [pendingReviews, setPendingReviews] = useState([]);
  const [unclaimedRoster, setUnclaimedRoster] = useState([]);
  const [reviewRosterPicks, setReviewRosterPicks] = useState({});
  const [bonusTasks, setBonusTasks] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [associates, setAssociates] = useState([]);
  const [myProfile, setMyProfile] = useState(null);
  const [roster, setRoster] = useState([]);
  const [managers, setManagers] = useState([]);
  const [activityEntries, setActivityEntries] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [newTask, setNewTask] = useState({ title: '', description: '', urgency: 'medium', openings: 1, pointValue: 50 });
  const [newAnnouncement, setNewAnnouncement] = useState({ title: '', description: '', urgency: 'medium', driversNeeded: 1, pointValue: 50 });
  const [newReward, setNewReward] = useState({ name: '', pointCost: 500, imageUrl: '' });
  const [adjustment, setAdjustment] = useState({ userId: '', delta: '', reason: '' });
  const [aliasDrafts, setAliasDrafts] = useState({});
  const [newRosterEntry, setNewRosterEntry] = useState({ fullName: '' });
  const [activityFilters, setActivityFilters] = useState({ actorName: '', actorId: '', action: '', pageSize: 15 });
  const [roleAssignmentUserId, setRoleAssignmentUserId] = useState('');
  const [activityCursors, setActivityCursors] = useState([null]);
  const [activityPage, setActivityPage] = useState(0);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [admins, setAdmins] = useState([]);
  const [syncStatus, setSyncStatus] = useState(null);

  const associatesById = Object.fromEntries(associates.map((a) => [a.id, a]));
  const canManagePermissions = role === 'admin' || myProfile?.permissions?.manageManagerPermissions;
  const canViewActivityLog = role === 'admin' || myProfile?.permissions?.viewActivityLog;

  useEffect(() => {
    const unsubPending = onSnapshot(query(collection(db, 'redemptionRequests'), where('status', '==', 'pending')), (snap) => {
      setPendingRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubRewards = onSnapshot(collection(db, 'rewards'), (snap) => {
      setRewards(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubReviews = onSnapshot(query(collection(db, 'pendingReview'), where('status', '==', 'open')), (snap) => {
      setPendingReviews(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubRoster = onSnapshot(query(collection(db, 'roster'), where('linkedUserId', '==', null)), (snap) => {
      setUnclaimedRoster(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubTasks = onSnapshot(collection(db, 'bonusTasks'), (snap) => {
      setBonusTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((t) => t.active));
    });
    const unsubAnnouncements = onSnapshot(collection(db, 'announcements'), (snap) => {
      setAnnouncements(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => a.active));
    });
    const unsubAssociates = onSnapshot(query(collection(db, 'users'), where('role', '==', 'associate')), (snap) => {
      setAssociates(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubFullRoster = onSnapshot(collection(db, 'roster'), (snap) => {
      setRoster(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubManagers = onSnapshot(query(collection(db, 'users'), where('role', '==', 'manager')), (snap) => {
      setManagers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubAdmins = onSnapshot(query(collection(db, 'users'), where('role', '==', 'admin')), (snap) => {
      setAdmins(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubPending();
      unsubRewards();
      unsubReviews();
      unsubRoster();
      unsubTasks();
      unsubAnnouncements();
      unsubAssociates();
      unsubFullRoster();
      unsubManagers();
      unsubAdmins();
    };
  }, []);

  useEffect(() => {
    if (!user?.uid) return undefined;
    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => setMyProfile(snap.data()));
    return unsub;
  }, [user?.uid]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'syncStatus', 'cortex'), (snap) => setSyncStatus(snap.data() || null));
    return unsub;
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

  async function handleResolveReview(reviewId, suggestedRosterId) {
    setMessage('');
    const rosterId = reviewRosterPicks[reviewId] ?? suggestedRosterId ?? '';
    if (!rosterId) {
      setMessage('Pick a roster entry to link before confirming.');
      return;
    }
    try {
      await resolveIdentityLink({ reviewId, rosterId });
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function handleCreateTask(e) {
    e.preventDefault();
    setMessage('');
    try {
      await createBonusTask({
        ...newTask,
        openings: Number(newTask.openings),
        pointValue: Number(newTask.pointValue),
      });
      setNewTask({ title: '', description: '', urgency: 'medium', openings: 1, pointValue: 50 });
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function handleCreateAnnouncement(e) {
    e.preventDefault();
    setMessage('');
    try {
      await createAnnouncement({
        ...newAnnouncement,
        driversNeeded: Number(newAnnouncement.driversNeeded),
        pointValue: Number(newAnnouncement.pointValue),
      });
      setNewAnnouncement({ title: '', description: '', urgency: 'medium', driversNeeded: 1, pointValue: 50 });
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function handleCreateReward(e) {
    e.preventDefault();
    setMessage('');
    try {
      await addDoc(collection(db, 'rewards'), {
        name: newReward.name,
        pointCost: Number(newReward.pointCost),
        description: '',
        imageUrl: newReward.imageUrl || null,
        active: true,
      });
      setNewReward({ name: '', pointCost: 500, imageUrl: '' });
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function handleToggleRewardActive(reward) {
    setMessage('');
    try {
      await updateDoc(doc(db, 'rewards', reward.id), { active: !reward.active });
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function handleChangeRewardImage(rewardId, imageUrl) {
    setMessage('');
    try {
      await updateDoc(doc(db, 'rewards', rewardId), { imageUrl });
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function handleDeleteReward(rewardId) {
    setMessage('');
    try {
      await deleteDoc(doc(db, 'rewards', rewardId));
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function handleAdjustPoints(e) {
    e.preventDefault();
    setMessage('');
    try {
      await adjustPoints({ userId: adjustment.userId, delta: Number(adjustment.delta), reason: adjustment.reason });
      setMessage('Points adjusted.');
      setAdjustment({ userId: '', delta: '', reason: '' });
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function handleAddAlias(rosterId) {
    setMessage('');
    const alias = (aliasDrafts[rosterId] || '').trim();
    if (!alias) return;
    try {
      await addRosterAlias({ rosterId, alias });
      setAliasDrafts((prev) => ({ ...prev, [rosterId]: '' }));
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function handleToggleRosterActive(entry) {
    setMessage('');
    try {
      await setRosterActive({ rosterId: entry.id, active: !entry.active });
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function handleCreateRosterEntry(e) {
    e.preventDefault();
    setMessage('');
    try {
      await createRosterEntry({ fullName: newRosterEntry.fullName });
      setNewRosterEntry({ fullName: '' });
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function handleTogglePermission(managerId, permission, enabled) {
    setMessage('');
    try {
      await setManagerPermission({ managerId, permission, enabled });
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function handleSetUserRole(userId, newRole) {
    setMessage('');
    try {
      await setUserRole({ userId, role: newRole });
    } catch (err) {
      setMessage(err.message);
    }
  }

  // activityCursors[i] is the startAfterId needed to fetch page i (index 0
  // is always null/first-page). Fetching page N appends the cursor for
  // page N+1, so "next" always has what it needs and "prev" replays a
  // cursor we already have instead of re-deriving it.
  async function loadActivityPage(pageIndex, cursors) {
    setMessage('');
    try {
      const res = await queryActivityLog({
        actorName: activityFilters.actorName || undefined,
        actorId: activityFilters.actorId || undefined,
        action: activityFilters.action || undefined,
        limit: Number(activityFilters.pageSize),
        startAfterId: cursors[pageIndex] || undefined,
      });
      setActivityEntries(res.data.entries);
      setActivityHasMore(res.data.hasMore);
      if (res.data.lastId) {
        const updated = [...cursors];
        updated[pageIndex + 1] = res.data.lastId;
        setActivityCursors(updated);
      }
      setActivityPage(pageIndex);
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function handleSearchActivityLog(e) {
    e.preventDefault();
    const cursors = [null];
    setActivityCursors(cursors);
    await loadActivityPage(0, cursors);
  }

  async function handleActivityNextPage() {
    await loadActivityPage(activityPage + 1, activityCursors);
  }

  async function handleActivityPrevPage() {
    if (activityPage === 0) return;
    await loadActivityPage(activityPage - 1, activityCursors);
  }

  const SYNC_STALE_DAYS = 8;
  const lastSuccessAt = syncStatus?.lastSuccessAt?.toDate ? syncStatus.lastSuccessAt.toDate() : null;
  const lastAttemptAt = syncStatus?.lastAttemptAt?.toDate ? syncStatus.lastAttemptAt.toDate() : null;
  const daysSinceSuccess = lastSuccessAt ? (Date.now() - lastSuccessAt.getTime()) / (1000 * 60 * 60 * 24) : null;
  const isCurrentlyFailing = !!syncStatus?.lastError && (!lastSuccessAt || (lastAttemptAt && lastAttemptAt > lastSuccessAt));
  const isStale = daysSinceSuccess === null || daysSinceSuccess > SYNC_STALE_DAYS;
  const showSyncWarning = isCurrentlyFailing || isStale;
  const showAdminPanel = activeTab === 'admin';
  const hasAnyAdminAccess = role === 'admin' || canManagePermissions || canViewActivityLog;

  return (
    <div>
      {message && <div className="card"><p>{message}</p></div>}

      {!showAdminPanel && showSyncWarning && (
        <div className="card sync-warning-card">
          <h2>⚠️ {isCurrentlyFailing ? 'Automatic Cortex sync failed' : 'Cortex sync may be out of date'}</h2>
          <p className="muted">
            {lastSuccessAt
              ? `Last successful sync: ${lastSuccessAt.toLocaleDateString()} (${Math.floor(daysSinceSuccess)} days ago).`
              : 'No successful sync has been recorded yet.'}
          </p>
          {syncStatus?.lastError && (
            <p className="error-text">Last error: {syncStatus.lastError}</p>
          )}
          <p className="muted">
            If the weekly automatic sync didn't run, make sure this week's Cortex CSV is in the Okami Rewards Program Drive folder, then force a sync below.
          </p>
          <button className="btn btn-primary" disabled={busy} onClick={() => handleAction(() => manualCortexSync(), 'Cortex sync complete.')}>
            Force Sync Now
          </button>
        </div>
      )}

      {!showAdminPanel && (
      <>
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
        <h2>Pending signup confirmations ({pendingReviews.length})</h2>
        {pendingReviews.length === 0 && <p className="muted">Nothing pending.</p>}
        {pendingReviews.map((review) => (
          <div className="list-row" key={review.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <span>New driver says their name is <strong>{review.enteredName}</strong></span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                value={reviewRosterPicks[review.id] ?? review.suggestedRosterId ?? ''}
                onChange={(e) => setReviewRosterPicks((prev) => ({ ...prev, [review.id]: e.target.value }))}
              >
                <option value="">Select a roster match...</option>
                {unclaimedRoster.map((r) => (
                  <option value={r.id} key={r.id}>{r.cortexFullName}</option>
                ))}
              </select>
              <button className="btn btn-primary" onClick={() => handleResolveReview(review.id, review.suggestedRosterId)}>
                Link & confirm
              </button>
            </div>
          </div>
        ))}
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
        <h2>Bonus tasks</h2>
        <form onSubmit={handleCreateTask} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
          <div className="field" style={{ flex: '1 1 160px' }}>
            <label>Title</label>
            <input value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} required />
          </div>
          <div className="field" style={{ flex: '2 1 220px' }}>
            <label>Description</label>
            <input value={newTask.description} onChange={(e) => setNewTask({ ...newTask, description: e.target.value })} />
          </div>
          <div className="field">
            <label>Urgency</label>
            <select value={newTask.urgency} onChange={(e) => setNewTask({ ...newTask, urgency: e.target.value })}>
              {BONUS_URGENCY.map((u) => <option value={u} key={u}>{u}</option>)}
            </select>
          </div>
          <div className="field" style={{ width: 90 }}>
            <label>Openings</label>
            <input type="number" min="1" value={newTask.openings} onChange={(e) => setNewTask({ ...newTask, openings: e.target.value })} required />
          </div>
          <div className="field" style={{ width: 100 }}>
            <label>Points</label>
            <input type="number" min="1" value={newTask.pointValue} onChange={(e) => setNewTask({ ...newTask, pointValue: e.target.value })} required />
          </div>
          <button className="btn btn-primary" type="submit">Add task</button>
        </form>
        {bonusTasks.length === 0 && <p className="muted">No active bonus tasks.</p>}
        {bonusTasks.map((task) => <BonusTaskCard task={task} associatesById={associatesById} key={task.id} />)}
      </div>

      <div className="card">
        <h2>Area of highest need</h2>
        <form onSubmit={handleCreateAnnouncement} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
          <div className="field" style={{ flex: '1 1 160px' }}>
            <label>Title</label>
            <input value={newAnnouncement.title} onChange={(e) => setNewAnnouncement({ ...newAnnouncement, title: e.target.value })} required />
          </div>
          <div className="field" style={{ flex: '2 1 220px' }}>
            <label>Description</label>
            <input value={newAnnouncement.description} onChange={(e) => setNewAnnouncement({ ...newAnnouncement, description: e.target.value })} />
          </div>
          <div className="field">
            <label>Urgency</label>
            <select value={newAnnouncement.urgency} onChange={(e) => setNewAnnouncement({ ...newAnnouncement, urgency: e.target.value })}>
              {ANNOUNCEMENT_URGENCY.map((u) => <option value={u} key={u}>{u}</option>)}
            </select>
          </div>
          <div className="field" style={{ width: 110 }}>
            <label>Drivers needed</label>
            <input type="number" min="1" value={newAnnouncement.driversNeeded} onChange={(e) => setNewAnnouncement({ ...newAnnouncement, driversNeeded: e.target.value })} required />
          </div>
          <div className="field" style={{ width: 100 }}>
            <label>Points</label>
            <input type="number" min="1" value={newAnnouncement.pointValue} onChange={(e) => setNewAnnouncement({ ...newAnnouncement, pointValue: e.target.value })} required />
          </div>
          <button className="btn btn-primary" type="submit">Post need</button>
        </form>
        <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>
          Only one urgent need should really be live at a time - archive the old one before posting a new one.
        </p>
        {announcements.length === 0 && <p className="muted">No active announcement.</p>}
        {announcements.map((a) => <AnnouncementCard announcement={a} associatesById={associatesById} key={a.id} />)}
      </div>

      <div className="card">
        <h2>Reward catalog</h2>
        <form onSubmit={handleCreateReward} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label>Reward name</label>
            <input value={newReward.name} onChange={(e) => setNewReward({ ...newReward, name: e.target.value })} required />
          </div>
          <div className="field" style={{ width: 120 }}>
            <label>Point cost</label>
            <input type="number" min="1" value={newReward.pointCost} onChange={(e) => setNewReward({ ...newReward, pointCost: e.target.value })} required />
          </div>
          <button className="btn btn-primary" type="submit">Add reward</button>
        </form>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
          {newReward.imageUrl && (
            <img src={newReward.imageUrl} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8 }} />
          )}
          <RewardImageUpload onUploaded={(url) => setNewReward({ ...newReward, imageUrl: url })} />
        </div>
        {rewards.length === 0 && <p className="muted">No rewards yet - seed the catalog above.</p>}
        {rewards.map((reward) => (
          <div className="list-row" key={reward.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {reward.imageUrl && (
                  <img src={reward.imageUrl} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6 }} />
                )}
                {reward.name} - {reward.pointCost} pts {!reward.active && '(inactive)'}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-outline" onClick={() => handleToggleRewardActive(reward)}>
                  {reward.active ? 'Deactivate' : 'Activate'}
                </button>
                <button className="btn btn-outline" onClick={() => handleDeleteReward(reward.id)}>Delete</button>
              </div>
            </div>
            <RewardImageUpload onUploaded={(url) => handleChangeRewardImage(reward.id, url)} />
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Manual point adjustment</h2>
        <form onSubmit={handleAdjustPoints} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label>Driver</label>
            <SearchableSelect
              placeholder="Search for a driver..."
              value={adjustment.userId}
              onChange={(value) => setAdjustment({ ...adjustment, userId: value })}
              options={associates.map((a) => ({ value: a.id, label: a.fullName || a.email }))}
            />
          </div>
          <div className="field" style={{ width: 120 }}>
            <label>Points (+/-)</label>
            <input type="number" value={adjustment.delta} onChange={(e) => setAdjustment({ ...adjustment, delta: e.target.value })} required />
          </div>
          <div className="field" style={{ flex: '1 1 220px' }}>
            <label>Reason</label>
            <input value={adjustment.reason} onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })} required />
          </div>
          <button className="btn btn-primary" type="submit" disabled={!adjustment.userId}>Apply</button>
        </form>
      </div>

      {adjustment.userId && associatesById[adjustment.userId] && (
        <DriverPointHistory driver={{ id: adjustment.userId, ...associatesById[adjustment.userId] }} />
      )}

      <div className="card">
        <h2>Roster</h2>
        <form onSubmit={handleCreateRosterEntry} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
          <div className="field" style={{ flex: '1 1 240px' }}>
            <label>Add a driver manually (before their first Cortex report)</label>
            <input value={newRosterEntry.fullName} onChange={(e) => setNewRosterEntry({ fullName: e.target.value })} required />
          </div>
          <button className="btn btn-outline" type="submit">Add to roster</button>
        </form>
        {roster.length === 0 && <p className="muted">No roster entries yet.</p>}
        {roster.map((entry) => (
          <div className="list-row" key={entry.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                {entry.cortexFullName}{' '}
                <span className="muted">
                  ({entry.linkedUserId ? 'linked' : 'unclaimed'}{entry.active === false ? ', inactive' : ''})
                </span>
              </span>
              <button className="btn btn-outline" onClick={() => handleToggleRosterActive(entry)}>
                {entry.active === false ? 'Reactivate' : 'Deactivate'}
              </button>
            </div>
            {entry.aliases?.length > 0 && (
              <p className="muted">Aliases: {entry.aliases.join(', ')}</p>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                placeholder="Add a nickname/alias"
                value={aliasDrafts[entry.id] || ''}
                onChange={(e) => setAliasDrafts((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                style={{ flex: 1 }}
              />
              <button className="btn btn-outline" onClick={() => handleAddAlias(entry.id)}>Add alias</button>
            </div>
          </div>
        ))}
      </div>
      </>
      )}

      {showAdminPanel && !hasAnyAdminAccess && (
        <div className="card">
          <h2>Admin panel</h2>
          <p className="muted">You haven't been granted any admin permissions yet - ask an admin to delegate activity log access or manager-permission management to you.</p>
        </div>
      )}

      {showAdminPanel && role === 'admin' && (
        <div className="card">
          <h2>Privilege assignment</h2>
          <p className="muted">Promote an employee to manager or admin, or change someone's role back.</p>
          <div className="field" style={{ maxWidth: 360, marginTop: 12 }}>
            <label>Select employee / driver</label>
            <SearchableSelect
              placeholder="Search for anyone..."
              value={roleAssignmentUserId}
              onChange={setRoleAssignmentUserId}
              options={[...associates, ...managers, ...admins]
                .filter((u) => u.id !== user.uid)
                .map((u) => ({ value: u.id, label: `${u.fullName || u.email} - ${u.role}` }))}
            />
          </div>
          {roleAssignmentUserId && (() => {
            const target = [...associates, ...managers, ...admins].find((u) => u.id === roleAssignmentUserId);
            if (!target) return null;
            return (
              <div style={{ marginTop: 16 }}>
                <p className="muted">Current role: <strong>{target.role}</strong></p>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {['associate', 'manager', 'admin'].map((r) => (
                    <button
                      key={r}
                      className={target.role === r ? 'btn btn-primary' : 'btn btn-outline'}
                      onClick={() => handleSetUserRole(target.id, r)}
                    >
                      {r === 'associate' ? 'Employee' : r === 'manager' ? 'Manager' : 'Administrator'}
                    </button>
                  ))}
                </div>
                {target.role === 'manager' && (
                  <div style={{ marginTop: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
                      <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
                        <input
                          type="checkbox"
                          checked={!!target.permissions?.[key]}
                          onChange={(e) => handleTogglePermission(target.id, key, e.target.checked)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {showAdminPanel && role === 'admin' && (
        <div className="card">
          <h2>Privileged roster ({managers.length + admins.length})</h2>
          <p className="muted">Everyone who currently holds manager or admin access.</p>
          {[...managers, ...admins].length === 0 && <p className="muted">No manager or admin accounts yet.</p>}
          {[...managers, ...admins].map((u) => (
            <div className="list-row" key={u.id}>
              <span>
                {u.fullName || u.email} <span className="badge badge-pending">{u.role}</span>
              </span>
              {u.id !== user.uid && (
                <button className="btn btn-outline" onClick={() => handleSetUserRole(u.id, 'associate')}>
                  Revoke privileges
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showAdminPanel && role === 'manager' && canManagePermissions && (
        <div className="card">
          <h2>Manager permissions</h2>
          <p className="muted">Delegate specific abilities to individual managers.</p>
          {managers.length === 0 && <p className="muted">No manager accounts yet.</p>}
          {managers.map((m) => (
            <div className="list-row" key={m.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <strong>{m.fullName || m.email}</strong>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {Object.entries(PERMISSION_LABELS)
                  .filter(([key]) => role === 'admin' || key !== 'manageManagerPermissions')
                  .map(([key, label]) => (
                    <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
                      <input
                        type="checkbox"
                        checked={!!m.permissions?.[key]}
                        onChange={(e) => handleTogglePermission(m.id, key, e.target.checked)}
                      />
                      {label}
                    </label>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdminPanel && canViewActivityLog && (
        <div className="card">
          <h2>Activity log</h2>
          {role === 'manager' && (
            <p className="muted">You'll only see driver activity here, never other managers' or admins'.</p>
          )}
          <form onSubmit={handleSearchActivityLog} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label>Search by name</label>
              <input
                placeholder="Search logs by manager, admin, or employee name..."
                value={activityFilters.actorName}
                onChange={(e) => setActivityFilters({ ...activityFilters, actorName: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Quick filter by user</label>
              <select
                value={activityFilters.actorId}
                onChange={(e) => setActivityFilters({ ...activityFilters, actorId: e.target.value })}
              >
                <option value="">All users</option>
                {associates.map((a) => <option value={a.id} key={a.id}>{a.fullName || a.email} (employee)</option>)}
                {role === 'admin' && managers.map((m) => <option value={m.id} key={m.id}>{m.fullName || m.email} (manager)</option>)}
                {role === 'admin' && admins.map((a) => <option value={a.id} key={a.id}>{a.fullName || a.email} (admin)</option>)}
              </select>
            </div>
            <div className="field">
              <label>Action</label>
              <input
                placeholder="e.g. request_redemption"
                value={activityFilters.action}
                onChange={(e) => setActivityFilters({ ...activityFilters, action: e.target.value })}
              />
            </div>
            <div className="field" style={{ width: 90 }}>
              <label>Per page</label>
              <select
                value={activityFilters.pageSize}
                onChange={(e) => setActivityFilters({ ...activityFilters, pageSize: e.target.value })}
              >
                <option value={15}>15</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </div>
            <button className="btn btn-primary" type="submit">Search</button>
          </form>
          {activityEntries === null && <p className="muted">Run a search to see recent activity.</p>}
          {activityEntries?.length === 0 && <p className="muted">No matching entries.</p>}
          {activityEntries?.map((entry) => (
            <div className="list-row" key={entry.id}>
              <span>
                <strong>{entry.actorName}</strong> ({entry.actorPosition}) - {entry.action}
              </span>
              <span className="muted">
                {entry.createdAt?.seconds ? new Date(entry.createdAt.seconds * 1000).toLocaleString() : ''}
              </span>
            </div>
          ))}
          {activityEntries !== null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <span className="muted">Page {activityPage + 1}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-outline" disabled={activityPage === 0} onClick={handleActivityPrevPage}>
                  ‹ Prev
                </button>
                <button className="btn btn-outline" disabled={!activityHasMore} onClick={handleActivityNextPage}>
                  Next ›
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
