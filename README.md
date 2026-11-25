# visitas-tito
organização visitas tito

## Ativação

1. Em um projeto Supabase dedicado, execute `supabase/setup.sql` no SQL Editor uma vez.
2. Em Authentication → Users, crie as duas contas da família. Autorize apenas seus IDs:
   `insert into tito_private.family (user_id) values ('UUID_1'), ('UUID_2');`
3. Em `config.js`, informe a URL do projeto e a chave **publishable**. Mantenha senhas, chaves secretas e dados de visitantes fora do repositório.
4. No GitHub Pages, publique a branch `main` a partir de `/(root)`.
5. Entre em `agenda.html` para liberar as datas quando estiverem definidas. Cada data tem seis horários, de 13h a 15h30, com até quatro pessoas por reserva. A opção de pausar preserva as reservas já confirmadas.

Para conferir a integração antes de compartilhar, libere uma data de teste, abra o convite em duas janelas e tente confirmar o mesmo horário nas duas. Uma confirmação deve aparecer no painel. Cancele pela página da reserva e pause a data de teste antes de liberar as datas reais.
