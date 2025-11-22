import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ClerkProvider, SignedIn, SignedOut, RedirectToSignIn, SignIn, SignUp } from '@clerk/clerk-react';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import AthleteProfile from './pages/AthleteProfile';

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!clerkPubKey) {
  throw new Error("Missing Publishable Key")
}

function App() {
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      appearance={{
        variables: {
          colorPrimary: '#F97316', // Orange
          colorText: 'white',
          colorBackground: '#111827',
          colorInputBackground: '#1F2937',
          colorInputText: 'white',
          colorTextSecondary: '#9CA3AF', // Gray-400
        },
        elements: {
          formButtonPrimary: 'bg-orange-500 hover:bg-orange-600 text-white',
          footerActionLink: 'text-orange-400 hover:text-orange-300',
          card: 'bg-gray-900 border border-white/10',
          headerTitle: 'text-white',
          headerSubtitle: 'text-gray-400',
          socialButtonsBlockButton: 'bg-white/5 border-white/10 text-white hover:bg-white/10',
          socialButtonsBlockButtonText: 'text-white',
          dividerLine: 'bg-white/10',
          dividerText: 'text-gray-400',
          formFieldLabel: 'text-gray-300',
          formFieldInput: 'bg-gray-800 border-gray-700 text-white',
        }
      }}
    >
      <Router>
        <Routes>
          {/* Public Route: Landing Page */}
          <Route path="/" element={
            <>
              <SignedIn>
                <Navigate to="/dashboard" replace />
              </SignedIn>
              <SignedOut>
                <Landing />
              </SignedOut>
            </>
          } />

          {/* Auth Routes */}
          <Route path="/sign-in/*" element={<div className="flex justify-center items-center h-screen bg-gray-900"><SignIn routing="path" path="/sign-in" /></div>} />
          <Route path="/sign-up/*" element={<div className="flex justify-center items-center h-screen bg-gray-900"><SignUp routing="path" path="/sign-up" /></div>} />

          {/* Private Route: Dashboard */}
          <Route
            path="/dashboard/*"
            element={
              <>
                <SignedIn>
                  <Dashboard />
                </SignedIn>
                <SignedOut>
                  <RedirectToSignIn />
                </SignedOut>
              </>
            }
          />

          {/* Private Route: Athlete Profile */}
          <Route
            path="/athlete/:id"
            element={
              <>
                <SignedIn>
                  <AthleteProfile />
                </SignedIn>
                <SignedOut>
                  <RedirectToSignIn />
                </SignedOut>
              </>
            }
          />
        </Routes>
      </Router>
    </ClerkProvider>
  );
}

export default App;
