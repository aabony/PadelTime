import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { authClient } from "./lib/auth";
import { PageSpinner } from "./components/ui";
import { Landing } from "./pages/Landing";
import { AuthPage } from "./pages/AuthPage";
import { Home } from "./pages/Home";
import { SessionPage } from "./pages/SessionPage";
import { JoinPage } from "./pages/JoinPage";
import { PrintSheetPage } from "./pages/PrintSheetPage";
import { PlanPage } from "./pages/PlanPage";
import { ProfilePage } from "./pages/ProfilePage";
import { MembersPage } from "./pages/MembersPage";
import { firstName } from "./lib/format";

export function Logo({ to = "/app" }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2 font-black tracking-tight text-navy">
      <span className="text-xl">🎾</span>
      <span className="text-lg">
        Padel<span className="text-royal">Time</span>
      </span>
    </Link>
  );
}

function AppLayout() {
  const { data: session, isPending, isRefetching } = authClient.useSession();
  const location = useLocation();
  const navigate = useNavigate();

  // Never bounce to login while a session read is still in flight.
  if (isPending || (isRefetching && !session)) return <PageSpinner />;
  if (!session) {
    // Keep the query string: the planner hands its setup over as /app?new=1&players=…
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Logo />
          <div className="flex items-center gap-3">
            <Link
              to={`/profile?next=${encodeURIComponent(location.pathname + location.search)}`}
              className="text-sm font-semibold text-muted hover:text-navy"
              aria-label="Your profile"
            >
              {firstName(session.user.name) || "Profile"}
            </Link>
            <button
              className="rounded-full px-3 py-1.5 text-sm font-semibold text-muted hover:bg-line hover:text-navy"
              onClick={async () => {
                await authClient.signOut();
                navigate("/");
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 pb-28">
        <Outlet />
      </main>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route path="/admin" element={<AuthPage mode="admin" />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="/join/:code" element={<JoinPage />} />
      {/* The TV board is gone: old board / results links land on the join page, which shows the results. */}
      <Route path="/board/:code" element={<ToJoin />} />
      <Route path="/print" element={<PrintSheetPage />} />
      <Route path="/plan" element={<PlanPage />} />
      <Route element={<AppLayout />}>
        <Route path="/app" element={<Home />} />
        <Route path="/app/sessions/:id" element={<SessionPage />} />
        <Route path="/app/members" element={<MembersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function ToJoin() {
  const { code = "" } = useParams();
  return <Navigate to={`/join/${code}`} replace />;
}
