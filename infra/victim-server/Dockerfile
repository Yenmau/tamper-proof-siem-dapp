FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      rsyslog openssh-server supervisor procps \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /run/sshd /siem-batches /opt/shipper

# User target brute force (password lemah SENGAJA, hanya untuk simulasi)
RUN useradd -m -s /bin/bash victim && echo "victim:password123" | chpasswd \
    && useradd -m -s /bin/bash admin && echo "admin:admin" | chpasswd

COPY rsyslog.conf /etc/rsyslog.conf
COPY supervisord.conf /etc/supervisor/conf.d/siem.conf
COPY shipper/ /opt/shipper/

EXPOSE 22
CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
