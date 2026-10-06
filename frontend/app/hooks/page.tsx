import { redirect } from 'next/navigation';

// Hooks now live inside Content Lab.
export default function HooksRedirect() { redirect('/lab?view=hooks'); }
