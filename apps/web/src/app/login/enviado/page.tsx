export default function EnlaceEnviadoPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Revisa tu correo</h1>
      <p className="text-muted-foreground text-sm">
        Te hemos enviado un enlace de acceso. Caduca en 15 minutos y sólo sirve una vez.
      </p>
    </main>
  );
}
