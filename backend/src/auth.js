/**
 * ============================================================================
 * auth.js — Autenticação e perfis de acesso do portal (v2 / Fase 3)
 * ============================================================================
 *
 * PERFIS (hierárquicos — decisão do orientador em 02/09/2026):
 *   visualizacao → só vê dashboards e histórico
 *   analise      → visualização + download das métricas (CSV)
 *   admin        → tudo + cadastra salas, destinatários WhatsApp e usuários
 *
 * Sessão: JWT (12 h) assinado com JWT_SECRET, enviado pelo frontend no
 * header `Authorization: Bearer <token>`.
 * Senhas: hash bcrypt (nunca armazenadas em claro).
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { pool } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('[auth] JWT_SECRET não definido — usando segredo aleatório (as sessões caem a cada restart).');
}

export const NIVEL = { visualizacao: 1, analise: 2, admin: 3 };
const TOKEN_HORAS = 12;

export function hashSenha(senha) {
  return bcrypt.hashSync(senha, 10);
}

/**
 * Cria o usuário administrador inicial quando a tabela está vazia.
 * Credenciais vêm de ADMIN_USUARIO / ADMIN_SENHA (padrão admin / admin123 —
 * o log avisa para trocar imediatamente).
 */
export async function seedAdmin() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM usuarios');
  if (rows[0].n > 0) return;
  const usuario = process.env.ADMIN_USUARIO || 'admin';
  const senha = process.env.ADMIN_SENHA || 'admin123';
  await pool.query(
    `INSERT INTO usuarios (nome, usuario, senha_hash, perfil)
     VALUES ('Administrador', $1, $2, 'admin')`,
    [usuario, hashSenha(senha)]
  );
  console.log(
    `[auth] Usuário administrador "${usuario}" criado.` +
    (process.env.ADMIN_SENHA ? '' : ' ⚠️  SENHA PADRÃO "admin123" — troque no primeiro acesso!')
  );
}

/** Valida credenciais e devolve o token de sessão (ou null). */
export async function login(usuario, senha) {
  const { rows } = await pool.query(
    'SELECT * FROM usuarios WHERE usuario = $1 AND ativo', [usuario]
  );
  const u = rows[0];
  if (!u || !bcrypt.compareSync(String(senha || ''), u.senha_hash)) return null;
  const token = jwt.sign(
    { sub: u.id, usuario: u.usuario, nome: u.nome, perfil: u.perfil },
    JWT_SECRET,
    { expiresIn: `${TOKEN_HORAS}h` }
  );
  return { token, nome: u.nome, perfil: u.perfil, usuario: u.usuario };
}

/**
 * Middleware de proteção: exige login com perfil >= `minimo`.
 * Uso: app.get('/api/x', exigirPerfil('analise'), handler)
 */
export function exigirPerfil(minimo) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ erro: 'Autenticação necessária' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if ((NIVEL[payload.perfil] || 0) < (NIVEL[minimo] || 99)) {
        return res.status(403).json({ erro: 'Permissão insuficiente para esta ação' });
      }
      req.usuario = payload;
      next();
    } catch {
      return res.status(401).json({ erro: 'Sessão inválida ou expirada' });
    }
  };
}
