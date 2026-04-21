'use client';

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import WasteReportForm from '@/components/WasteReportForm';

export default function WorkerDashboard() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'overview' | 'waste'>('overview');

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1>Worker Dashboard</h1>
        <button onClick={logout} style={styles.logoutButton}>Logout</button>
      </div>
      
      <div style={styles.tabs}>
        <button 
          onClick={() => setActiveTab('overview')}
          style={{
            ...styles.tabButton,
            ...(activeTab === 'overview' ? styles.activeTab : {}),
          }}
        >
          Overview
        </button>
        <button 
          onClick={() => setActiveTab('waste')}
          style={{
            ...styles.tabButton,
            ...(activeTab === 'waste' ? styles.activeTab : {}),
          }}
        >
          Report Waste
        </button>
      </div>

      {activeTab === 'overview' && (
        <div style={styles.content}>
          <p>Welcome, Worker {user?.email}</p>
          <div style={styles.tasks}>
            <div style={styles.task}>
              <h3>Order Preparation</h3>
              <p>View and prepare incoming orders</p>
            </div>
            <div style={styles.task}>
              <h3>Bin Management</h3>
              <p>Place prepared orders in assigned bins</p>
            </div>
            <div style={styles.task}>
              <h3>OTP Verification</h3>
              <p>Verify customer OTP at pickup</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'waste' && (
        <div style={styles.content}>
          <WasteReportForm />
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: '1000px', margin: '0 auto', padding: '20px' },
  header: { display: 'flex', justifyContent: 'space-between', marginBottom: '30px' },
  logoutButton: { padding: '8px 16px', backgroundColor: '#dc2626', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  tabs: { display: 'flex', gap: '0', marginBottom: '20px', borderBottom: '2px solid #e5e7eb' },
  tabButton: { 
    padding: '12px 24px',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '16px',
    borderBottom: '3px solid transparent',
    marginBottom: '-2px',
    transition: 'all 0.3s',
  },
  activeTab: {
    borderBottomColor: '#2563eb',
    color: '#2563eb',
    fontWeight: 'bold',
  },
  content: { padding: '20px' },
  tasks: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginTop: '20px' },
  task: { padding: '20px', backgroundColor: '#fff7ed', borderRadius: '8px', border: '1px solid #fed7aa' },
};
