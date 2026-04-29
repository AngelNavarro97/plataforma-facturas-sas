# Plataforma de Facturas — Smart Aligner Services

Plataforma web interna para gestionar facturas pendientes entre Ángel (admin) y Dani (jefe).

- **Ángel** crea facturas pendientes con sus datos.
- **Dani** entra, ve qué tiene que subir y adjunta el PDF o imagen correspondiente.
- **Ángel** revisa lo subido y marca la factura como revisada.
- Todo se sincroniza en tiempo real entre los dos dispositivos.

## Stack

- **HTML + JavaScript + CSS** (un único archivo `index.html`)
- **Supabase** como base de datos, autenticación, almacenamiento de archivos y sincronización en tiempo real
- **Vercel** para hospedar la web

## Estructura del proyecto

```
.
├── index.html                # La aplicación (lo que se sirve al navegador)
├── preview.html              # Diseño de referencia con datos de prueba (no se usa en producción)
├── RECURSOS/
│   ├── Logo Blanco.png       # Logo SAS
│   ├── Angel.png             # Foto de perfil de Ángel
│   └── Dani.png              # Foto de perfil de Dani
├── supabase/
│   └── schema.sql            # Esquema de base de datos (referencia, ya ejecutado en Supabase)
├── .gitignore
└── README.md
```

## Cómo funciona

1. La aplicación es estática (un único `index.html`) que se carga en el navegador.
2. Al iniciar sesión, hace una petición a Supabase Auth para verificar email y contraseña.
3. Una vez dentro, lee y escribe en la base de datos de Supabase (tabla `facturas`, `comentarios`, `historial`).
4. Los archivos PDF/imagen se guardan en el bucket de Storage `facturas` (privado, accesible solo a usuarios autenticados).
5. La sincronización en vivo se consigue con Supabase Realtime: cuando uno guarda un cambio, todos los navegadores conectados reciben la novedad y refrescan la pantalla automáticamente.

## Roles y permisos

| Acción | Admin (Ángel) | Jefe (Dani) |
|---|---|---|
| Ver facturas | ✓ | ✓ |
| Crear factura | ✓ | ✗ |
| Editar campos clave | ✓ | ✗ |
| Borrar factura | ✓ | ✗ |
| Subir archivo | ✓ | ✓ |
| Ver/descargar archivo | ✓ | ✓ |
| Marcar como Revisada | ✓ | ✗ |
| Comentar | ✓ | ✓ |

## Despliegue

Cualquier commit a la rama `main` redespliega automáticamente en Vercel.

## Credenciales

Las credenciales de los usuarios están en Supabase Auth (no en el código). El archivo HTML contiene la URL del proyecto Supabase y la clave pública anónima — la clave es segura para vivir en el cliente porque las políticas Row Level Security (RLS) de Supabase son las que protegen los datos.
