import getpass, hashlib, json, time, urllib.error, urllib.request

URL = "https://open-api.affiliate.shopee.com.br/graphql"
app_id = input("AppID: ").strip()
secret = getpass.getpass("Secret: ").strip()

fim = int(time.time())
inicio = fim - 7 * 24 * 3600  # últimos 7 dias

query = """{ conversionReport(purchaseTimeStart: %d, purchaseTimeEnd: %d, limit: 50) {
  nodes { conversionId purchaseTime totalCommission
          orders { orderId orderStatus } }
  pageInfo { hasNextPage scrollId } } }""" % (inicio, fim)

payload = json.dumps({"query": query})
ts = str(int(time.time()))
assinatura = hashlib.sha256((app_id + ts + payload + secret).encode()).hexdigest()

req = urllib.request.Request(URL, data=payload.encode(), headers={
    "Content-Type": "application/json",
    "Authorization": f"SHA256 Credential={app_id}, Timestamp={ts}, Signature={assinatura}",
})
try:
    resposta = urllib.request.urlopen(req).read().decode()
except urllib.error.HTTPError as erro:
    resposta = erro.read().decode()

with open("resposta.json", "w", encoding="utf-8") as f:
    f.write(resposta)
print(resposta[:1500])