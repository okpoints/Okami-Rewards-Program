import { useEffect, useRef, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

function toDate(value) {
  return value?.toDate ? value.toDate() : new Date(value);
}

export default function NotificationBell({ user }) {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    const notifQuery = query(collection(db, 'users', user.uid, 'notifications'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(notifQuery, (snap) => {
      setNotifications(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [user.uid]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  async function handleOpen() {
    setOpen((v) => !v);
  }

  async function handleMarkRead(notifId) {
    try {
      await updateDoc(doc(db, 'users', user.uid, 'notifications', notifId), { read: true });
    } catch {
      // best-effort - not worth surfacing an error for marking something read
    }
  }

  return (
    <div className="notification-bell" ref={panelRef}>
      <button className="notification-bell-trigger" onClick={handleOpen} aria-label="Notifications">
        🔔
        {unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>
      {open && (
        <div className="notification-panel">
          <div className="notification-panel-header">Notifications</div>
          {notifications.length === 0 && <p className="muted" style={{ padding: '12px 14px' }}>Nothing yet.</p>}
          {notifications.slice(0, 25).map((n) => (
            <div
              key={n.id}
              className={`notification-item${n.read ? '' : ' unread'}`}
              onClick={() => handleMarkRead(n.id)}
            >
              <p>{n.message}</p>
              <span className="muted" style={{ fontSize: 12 }}>{toDate(n.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
