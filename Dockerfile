# Servidor do site estático das eleições CE/BA.
#
# NÃO é necessário para publicar em Cloudflare Pages ou GitHub Pages
# (lá se envia a pasta pronta — ver PUBLICAR.md). Este contêiner serve
# para testar local do jeito que ficará no ar, publicar em serviço que
# aceite contêiner (Fly.io, Railway, VPS próprio) ou servir a consulta
# numa rede interna.
#
# O `gerar_site.py` copia este arquivo para dentro da pasta de saída
# (%LOCALAPPDATA%\site_eleicoes), que é o contexto do build — assim os
# 141 MB de dados NÃO passam pelo OneDrive:
#
#   python gerar_site.py
#   docker build -t eleicoes-ce-ba "%LOCALAPPDATA%\site_eleicoes"
#   docker run --rm -d -p 8080:80 --name eleicoes eleicoes-ce-ba
#   (abrir http://localhost:8080 ; parar com: docker stop eleicoes)
FROM nginx:1.27-alpine

COPY . /usr/share/nginx/html/
RUN rm -f /usr/share/nginx/html/Dockerfile

# Compressão: os JSON deste site comprimem muito bem (os maiores caem
# de ~4 MB para ~1 MB), e é o que torna aceitável abrir Salvador e
# Fortaleza. Cache longo para os dados (imutáveis entre extrações do
# TSE) e curto para o HTML/JS, que mudam a cada ajuste de interface.
RUN printf '%s\n' \
  'gzip on;' \
  'gzip_min_length 1024;' \
  'gzip_types application/json application/javascript text/css text/html;' \
  'gzip_vary on;' \
  'server {' \
  '  listen 80;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  location /d/ { add_header Cache-Control "public, max-age=86400"; }' \
  '  location / { add_header Cache-Control "no-cache"; }' \
  '}' \
  > /etc/nginx/conf.d/default.conf

EXPOSE 80
