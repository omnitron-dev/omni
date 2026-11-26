FROM docker.io/library/alpine:3.24.4@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf

RUN apk add --no-cache minio=0.20251015.172955-r8 minio-client=0.20250813.083541-r9 \
    && ln -s /usr/bin/mcli /usr/local/bin/mc \
    && minio --version && mc --version

EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data"]
