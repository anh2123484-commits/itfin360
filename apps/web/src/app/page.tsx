import { Button } from '@itfin360/ui';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">ITFin360</h1>
      <p className="text-muted-foreground text-sm">Gestión financiera 360º de un departamento IT</p>
      <Button variant="outline" size="sm" disabled>
        Sin funcionalidad todavía
      </Button>
    </main>
  );
}
