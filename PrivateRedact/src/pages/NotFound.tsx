import { Link } from 'react-router';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-6xl font-black text-white/10">404</p>
      <h1 className="text-xl font-bold text-white">Page not found</h1>
      <p className="text-sm text-gray-400">The page you are looking for does not exist.</p>
      <Link
        to="/"
        className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500"
      >
        Go home
      </Link>
    </div>
  );
}
