import Link from 'next/link';

export default function PrivacyPolicy() {
  return (
    <main style={{ maxWidth: 600, margin: '0 auto', padding: '24px 16px', color: '#fff', background: '#080C09', minHeight: '100vh' }}>
      <Link href="/" style={{ color: '#00FF7F', fontSize: 14, display: 'inline-block', marginBottom: 24 }}>
        ← Назад
      </Link>

      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Политика конфиденциальности</h1>
      <p style={{ color: '#3A6045', fontSize: 13, marginBottom: 32 }}>Последнее обновление: июнь 2026</p>

      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, marginTop: 24 }}>Что мы храним</h2>
      <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: 14 }}>
        NeuroWallet хранит зашифрованный криптографический ключ в localStorage вашего браузера. Ключ зашифрован вашим паролем — мы не имеем доступа к нему.
      </p>

      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, marginTop: 24 }}>Что мы НЕ храним</h2>
      <ul style={{ color: '#ccc', lineHeight: 1.8, fontSize: 14, paddingLeft: 20 }}>
        <li>Мнемоническая фраза (seed phrase) никогда не сохраняется — ни на серверах, ни в localStorage. Её знаете только вы.</li>
        <li>Приватные ключи в незашифрованном виде не хранятся и не передаются на серверы.</li>
      </ul>

      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, marginTop: 24 }}>Чаты с Нейрой</h2>
      <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: 14 }}>
        Сообщения могут передаваться в AI-провайдер (Anthropic) для обработки. Не включайте в сообщения приватные ключи или seed-фразы.
      </p>

      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, marginTop: 24 }}>Аналитика</h2>
      <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: 14 }}>
        Мы можем использовать анонимную аналитику для улучшения продукта. Личные данные не продаются третьим сторонам.
      </p>

      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, marginTop: 24 }}>Риски</h2>
      <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: 14 }}>
        Криптовалюты несут высокий финансовый риск. NeuroWallet не несёт ответственности за потерю средств вследствие пользовательских действий, потери пароля или seed-фразы.
      </p>

      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, marginTop: 24 }}>Контакт</h2>
      <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: 14 }}>
        По вопросам: <a href="mailto:support@neurowallet.tech" style={{ color: '#00FF7F' }}>support@neurowallet.tech</a>
      </p>
    </main>
  );
}
