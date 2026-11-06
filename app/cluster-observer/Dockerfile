FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -mod=mod -trimpath -ldflags="-s -w" -o /cluster-observer .

FROM gcr.io/distroless/static:nonroot
COPY --from=build /cluster-observer /cluster-observer
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/cluster-observer"]
