resource "azurerm_resource_group" "qdoc" {
  name     = "${var.name_prefix}-rg"
  location = var.location
}

resource "azurerm_container_registry" "qdoc" {
  name                 = coalesce(var.acr_name, "${var.name_prefix}acr")
  resource_group_name  = azurerm_resource_group.qdoc.name
  location             = azurerm_resource_group.qdoc.location
  sku                  = "Basic"
  admin_enabled        = false
  role_assignment_mode = "LegacyRegistryPermissions"
}

resource "azurerm_kubernetes_cluster" "qdoc" {
  name                = "${var.name_prefix}-aks"
  location            = azurerm_resource_group.qdoc.location
  resource_group_name = azurerm_resource_group.qdoc.name
  dns_prefix          = var.name_prefix
  sku_tier            = "Free"

  default_node_pool {
    name       = "system"
    node_count = var.node_count
    vm_size    = var.node_vm_size
  }

  identity {
    type = "SystemAssigned"
  }

  network_profile {
    network_plugin      = "azure"
    network_plugin_mode = "overlay"
    load_balancer_sku   = "standard"
  }
}

resource "azurerm_role_assignment" "acr_pull" {
  scope                            = azurerm_container_registry.qdoc.id
  role_definition_name             = "AcrPull"
  principal_id                     = azurerm_kubernetes_cluster.qdoc.kubelet_identity[0].object_id
  skip_service_principal_aad_check = true
}
