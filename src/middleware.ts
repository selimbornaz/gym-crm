import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_PATHS = ["/login", "/forgot-password", "/auth/callback", "/auth/confirm", "/api/cron"];

/**
 * Rafraîchit la session Supabase à chaque requête et redirige les visiteurs
 * non connectés vers /login. L'autorisation fine (rôle, salle) est vérifiée
 * ensuite côté serveur ET par la RLS ; ce middleware n'est qu'un premier filtre.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return new NextResponse("Configuration Supabase manquante : voir .env.example", { status: 500 });
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() valide le jeton auprès de Supabase (contrairement à getSession()).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }
  if (user && path === "/login") {
    const home = request.nextUrl.clone();
    home.pathname = "/dashboard";
    home.search = "";
    return NextResponse.redirect(home);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
