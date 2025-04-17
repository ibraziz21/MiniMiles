// // app/quests/page.tsx
// 'use client';

// import { useEffect, useState } from 'react';
// import { supabase } from '@/lib/supabaseClient';

// export default function QuestsPage() {
//   const [quests, setQuests] = useState([]);

//   useEffect(() => {
//     const fetchQuests = async () => {
//       const { data, error } = await supabase.from('quests').select('*');
//       if (error) console.error('Supabase error:', error);
//       else setQuests(data);
//     };

//     fetchQuests();
//   }, []);

//   return (
//     <div className="p-4">
//       <h1 className="text-xl font-bold mb-4">Quests</h1>
//       <ul className="space-y-2">
//         {quests.map((q: any) => (
//           <li key={q.id} className="bg-gray-100 p-4 rounded">{q.title}</li>
//         ))}
//       </ul>
//     </div>
//   );
// }
