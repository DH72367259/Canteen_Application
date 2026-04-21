'use client';

import React from 'react';
import { useAuth } from '@/lib/auth-context';

export default function VendorDashboard() {
  const { user, logout } = useAuth();

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1>Vendor Dashboard</h1>
        <button onClick={logout} style={styles.logoutButton}>Logout</button>
      </div>
      <div style={styles.content}>
        <p>Welcome, Vendor {user?.email || 'User'}</p>
        <div style={styles.moduleGrid}>
          <div style={styles.module}>Manage Staff Access</div>
          <div style={styles.module}>Manage Menu</div>
          <div style={styles.module}>Live Slots</div>
          <div style={styles.module}>Slot Orders Report</div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: '1000px', margin: '0 auto', padding: '20px' },
  header: { display: 'flex', justifyContent: 'space-between', marginBottom: '30px' },
  logoutButton: { padding: '8px 16px', backgroundColor: '#dc2626', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  content: { padding: '20px' },
  moduleGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '15px', marginTop: '20px' },
  module: { padding: '20px', backgroundColor: '#f0f9ff', borderRadius: '8px', border: '1px solid #bfdbfe', textAlign: 'center' },
};
