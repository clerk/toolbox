export class AuthorizationError extends Error {
  public request: Request;
  public response: Response;
  constructor(request: Request, response: Response) {
    const wwwAuthenticate = response.headers.get("WWW-Authenticate");
    super(
      `Request to ${request.url} returned 401. ${
        !wwwAuthenticate
          ? `The server did not provide a challenge from the WWW-Authenticate header.`
          : `The server provided the following challenge from the WWW-Authenticate header: ${wwwAuthenticate}`
      }`
    );
    this.request = request;
    this.response = response;
  }
}
