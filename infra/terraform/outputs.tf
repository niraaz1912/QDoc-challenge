output "resource_group" {
  value = azurerm_resource_group.qdoc.name
}

output "aks_name" {
  value = azurerm_kubernetes_cluster.qdoc.name
}

output "acr_name" {
  value = azurerm_container_registry.qdoc.name
}

output "acr_login_server" {
  value = azurerm_container_registry.qdoc.login_server
}
