export default function DashboardHeader({ name }: { name: string }) {
    return (
      <div className="px-4 pt-4">
        <h1 className="text-2xl font-bold mt-2">Welcome {name}!</h1>
      </div>
    );
}