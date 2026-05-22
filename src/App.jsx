import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CallProvider } from './contexts/CallContext';
import { usePresence } from './hooks/usePresence';
import { usePushNotifications } from './hooks/usePushNotifications';
import { soundManager } from './utils/sound-manager';
import Login from './pages/Login';
import ChatInterface from './pages/ChatInterface';
import ProtectedRoute from './components/ProtectedRoute';

// To redirect users who are already logged in away from the Login page
const PublicRoute = ({ children }) => {
  const { currentUser, loading } = useAuth();
  if (loading) return null;
  if (currentUser) return <Navigate to="/" />;
  return children;
}

function GlobalHooks() {
  usePresence();
  usePushNotifications();

  React.useEffect(() => {
    soundManager.init();
  }, []);

  return null;
}

function App() {
  return (
    <AuthProvider>
      <GlobalHooks />
      <CallProvider>
        <Router>
        <Routes>
          <Route 
            path="/login" 
            element={<PublicRoute><Login /></PublicRoute>} 
          />
          <Route 
            path="/" 
            element={<ProtectedRoute><ChatInterface /></ProtectedRoute>} 
          />
        </Routes>
      </Router>
      </CallProvider>
    </AuthProvider>
  );
}

export default App;
