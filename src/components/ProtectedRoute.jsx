import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { currentUser } = useAuth();

  if (!currentUser) {
    // Redirect to login page if user is not authenticated
    return <Navigate to="/login" replace />;
  }

  return children;
}
